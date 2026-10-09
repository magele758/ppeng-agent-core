#!/usr/bin/env node
/** --check only packs/installs/tests; it never authenticates to or publishes on npm. */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tagMismatchMessage, versionRequiredByRef } from './publish-npm-lib.mjs';
import { packPublicArtifacts, verifyPublicArtifacts, runArtifactCommand, PUBLIC_PACKAGES } from './npm-artifacts.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const dryRun = process.env.NPM_PUBLISH_DRY_RUN === '1';
if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: publish-npm-packages.mjs [--check]');
const staging = mkdtempSync(join(tmpdir(), 'ppeng-npm-artifacts-'));
try {
  const versions = Object.fromEntries(PUBLIC_PACKAGES.map(name => [name, JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8')).version]));
  const mismatch = tagMismatchMessage(versionRequiredByRef(process.env.GITHUB_REF_TYPE, process.env.GITHUB_REF_NAME), versions);
  if (mismatch) throw new Error(mismatch);
  runArtifactCommand(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-b', 'packages/api-types', 'packages/agent-loop'], root);
  const artifacts = packPublicArtifacts(root, staging);
  const evidence = verifyPublicArtifacts(root, staging, artifacts);
  mkdirSync(join(root, 'test-results'), { recursive: true });
  writeFileSync(join(root, 'test-results', 'npm-artifacts.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  if (!checkOnly) {
    const token = process.env.NODE_AUTH_TOKEN || process.env.NPM_TOKEN;
    const env = { ...process.env };
    if (token) {
      const userconfig = join(staging, 'publish.npmrc');
      writeFileSync(userconfig, `//registry.npmjs.org/:_authToken=${token}\n`, { mode: 0o600 });
      env.NPM_CONFIG_USERCONFIG = userconfig;
    }
    if (!dryRun) runArtifactCommand('npm', ['whoami', '--registry=https://registry.npmjs.org/'], root, env);
    // Preflight every version before the first publish; npm cannot atomically publish multiple packages.
    for (const artifact of artifacts) {
      let published = '';
      try { published = runArtifactCommand('npm', ['view', `${artifact.name}@${artifact.version}`, 'version', '--registry=https://registry.npmjs.org/'], root, env).trim(); }
      catch (error) {
        if (!/E404|404 Not Found/.test(error.message)) throw error;
      }
      if (published === artifact.version && !dryRun) throw new Error(`${artifact.name}@${artifact.version} already published; bump versions`);
    }
    for (const artifact of artifacts) {
      const args = ['publish', artifact.tarball, '--ignore-scripts', '--access', 'public', '--registry=https://registry.npmjs.org/'];
      if (dryRun) args.push('--dry-run');
      else if (process.env.GITHUB_ACTIONS === 'true') args.push('--provenance');
      console.log(runArtifactCommand('npm', args, root, env));
    }
  }
  console.log(checkOnly ? 'Package artifact verification passed (nothing published).' : dryRun ? 'Publish dry run passed.' : 'Published verified tarballs.');
} finally {
  rmSync(staging, { recursive: true, force: true });
}
