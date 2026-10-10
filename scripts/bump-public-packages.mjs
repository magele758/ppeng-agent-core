#!/usr/bin/env node
/** Rewrite the two public package versions. Does not call npm publish. */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_VERSION_FILES, planPublicRelease, rewritePublicVersionPins } from './publish-npm-lib.mjs';

function argValues(flag) {
  const values = [];
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flag) values.push(args[i + 1]);
  }
  return values.filter((value) => value != null);
}

const root = argValues('--root').at(-1) ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const versionType = argValues('--type').at(-1);
if (!versionType) {
  console.error('Usage: bump-public-packages.mjs --type patch|minor|major|republish [--registry-version x.y.z ...] [--root dir]');
  process.exit(1);
}

const repoVersions = Object.fromEntries(['api-types', 'agent-loop'].map((name) => {
  const pkg = JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'));
  return [name, pkg.version];
}));
const plan = planPublicRelease({
  versionType,
  repoVersions,
  registryVersions: argValues('--registry-version'),
});
let changed = false;
if (plan.bump) {
  for (const rel of PUBLIC_VERSION_FILES) {
    const file = join(root, rel);
    const before = readFileSync(file, 'utf8');
    const next = `${JSON.stringify(rewritePublicVersionPins(JSON.parse(before), plan.version), null, 2)}\n`;
    if (next === before) continue;
    writeFileSync(file, next);
    changed = true;
  }
}
console.log(`version=${plan.version}`);
console.log(`changed=${changed ? 'true' : 'false'}`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${plan.version}\nchanged=${changed ? 'true' : 'false'}\n`);
}
