#!/usr/bin/env node
/**
 * Publish workspace @ppeng/{api-types,agent-loop} as @mage-ai-lab/* on npmjs.
 * Does not rewrite the git workspace package names.
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

function run(cmd, args, cwd, extra = {}) {
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit", ...extra });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function rewriteScope(text) {
  return text.split(SCOPE_FROM).join(SCOPE_TO);
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

const whoami = spawnSync("npm", ["whoami", "--registry", REGISTRY], { encoding: "utf8" });
if (whoami.status !== 0) {
  console.error("npm login required against registry.npmjs.org");
  process.exit(1);
}
console.log(`publishing as ${whoami.stdout.trim()} → ${SCOPE_TO}*`);

run("npx", ["tsc", "-b", "packages/api-types", "packages/agent-loop"], ROOT);

const staging = mkdtempSync(join(tmpdir(), "ppeng-npm-"));
try {
  for (const name of PACKAGES) {
    const src = join(ROOT, "packages", name);
    const dest = join(staging, name);
    cpSync(src, dest, {
      recursive: true,
      filter: (p) => !p.includes("node_modules") && !p.endsWith("tsconfig.tsbuildinfo"),
    });
    rewritePackageJson(dest);
    rewriteTree(dest);
    console.log(`\n--- npm publish ${SCOPE_TO}${name} ---`);
    run("npm", ["publish", "--access", "public", "--registry", REGISTRY], dest);
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}

console.log("\npublished @mage-ai-lab/api-types and @mage-ai-lab/agent-loop");
