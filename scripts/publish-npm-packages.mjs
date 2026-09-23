#!/usr/bin/env node
/**
 * Publish workspace @ppeng/{api-types,agent-loop} as @mage-ai-lab/* on npmjs.
 * Does not rewrite the git workspace package names.
 *
 * Auth: local `npm login`, or CI `NODE_AUTH_TOKEN` / `NPM_TOKEN`.
 * Dry run: NPM_PUBLISH_DRY_RUN=1
 * Tag gate: GITHUB_REF_TYPE=tag and GITHUB_REF_NAME=npm-v<version> must match both packages.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCOPE_FROM = "@ppeng/";
const SCOPE_TO = "@mage-ai-lab/";
const REGISTRY = "https://registry.npmjs.org/";
const PACKAGES = ["api-types", "agent-loop"];
const DRY_RUN = process.env.NPM_PUBLISH_DRY_RUN === "1";

const token = process.env.NODE_AUTH_TOKEN || process.env.NPM_TOKEN || "";
const userconfig = token ? join(tmpdir(), `ppeng-npmrc-${process.pid}`) : "";
if (token) {
  writeFileSync(userconfig, `//registry.npmjs.org/:_authToken=${token}\n`, { mode: 0o600 });
}
const env = token ? { ...process.env, NPM_CONFIG_USERCONFIG: userconfig } : process.env;

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit", env });
  if (result.status !== 0) process.exit(result.status || 1);
}

function rewriteScope(text) {
  return text.split(SCOPE_FROM).join(SCOPE_TO);
}

function packageVersion(name) {
  const pkg = JSON.parse(readFileSync(join(ROOT, "packages", name, "package.json"), "utf8"));
  return pkg.version;
}

function assertTagMatches(versions) {
  if (process.env.GITHUB_REF_TYPE !== "tag") return;
  const tag = process.env.GITHUB_REF_NAME ?? "";
  if (!tag.startsWith("npm-v")) return;
  const expected = tag.slice("npm-v".length);
  for (const [name, version] of Object.entries(versions)) {
    if (version !== expected) {
      console.error(`tag ${tag} does not match packages/${name} version ${version}`);
      process.exit(1);
    }
  }
}

function alreadyPublished(name, version) {
  const result = spawnSync(
    "npm",
    ["view", `${SCOPE_TO}${name}@${version}`, "version", "--registry", REGISTRY],
    { encoding: "utf8", env },
  );
  return result.status === 0 && result.stdout.trim() === version;
}

function rewritePackageJson(pkgDir) {
  const pkgPath = join(pkgDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.name = rewriteScope(pkg.name);
  if (pkg.dependencies) {
    for (const [name, version] of Object.entries(pkg.dependencies)) {
      if (name.startsWith(SCOPE_FROM)) {
        pkg.dependencies[rewriteScope(name)] = version;
        delete pkg.dependencies[name];
      }
    }
  }
  pkg.publishConfig = { access: "public", registry: REGISTRY };
  if (process.env.GITHUB_REPOSITORY) {
    pkg.repository = {
      type: "git",
      url: `git+https://github.com/${process.env.GITHUB_REPOSITORY}.git`,
    };
  }
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function rewriteTree(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      rewriteTree(path);
      continue;
    }
    if (!/\.(js|cjs|mjs|d\.ts|map|md|json)$/.test(name)) continue;
    const before = readFileSync(path, "utf8");
    const after = rewriteScope(before);
    if (after !== before) writeFileSync(path, after);
  }
}

const versions = Object.fromEntries(PACKAGES.map((name) => [name, packageVersion(name)]));
assertTagMatches(versions);

if (!DRY_RUN) {
  const whoami = spawnSync("npm", ["whoami", "--registry", REGISTRY], { encoding: "utf8", env });
  if (whoami.status !== 0) {
    console.error("npm login required against registry.npmjs.org (or set NODE_AUTH_TOKEN / NPM_TOKEN)");
    process.exit(1);
  }
  console.log(`publishing as ${whoami.stdout.trim()} → ${SCOPE_TO}*`);
} else {
  console.log(`dry run → ${SCOPE_TO}*`);
}

run("npx", ["tsc", "-b", "packages/api-types", "packages/agent-loop"], ROOT);

const staging = mkdtempSync(join(tmpdir(), "ppeng-npm-"));
try {
  for (const name of PACKAGES) {
    const version = versions[name];
    if (alreadyPublished(name, version)) {
      const message = `${SCOPE_TO}${name}@${version} is already on npm; bump packages/${name}/package.json`;
      if (!DRY_RUN) {
        console.error(message);
        process.exit(1);
      }
      console.log(message);
    }
    const src = join(ROOT, "packages", name);
    const dest = join(staging, name);
    cpSync(src, dest, {
      recursive: true,
      filter: (p) => !p.includes("node_modules") && !p.endsWith("tsconfig.tsbuildinfo"),
    });
    rewritePackageJson(dest);
    rewriteTree(dest);
    const args = ["publish", "--access", "public", "--registry", REGISTRY];
    if (DRY_RUN) args.push("--dry-run");
    else if (process.env.GITHUB_ACTIONS === "true") args.push("--provenance");
    console.log(`\n--- npm publish ${SCOPE_TO}${name}@${version}${DRY_RUN ? " (dry-run)" : ""} ---`);
    run("npm", args, dest);
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
  if (userconfig) rmSync(userconfig, { force: true });
}

console.log(
  DRY_RUN
    ? "\ndry run ok for @mage-ai-lab/api-types and @mage-ai-lab/agent-loop"
    : "\npublished @mage-ai-lab/api-types and @mage-ai-lab/agent-loop",
);
