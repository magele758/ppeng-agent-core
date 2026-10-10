#!/usr/bin/env node
/** --check only packs/installs/tests; it never authenticates to or publishes on npm. */
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertPublishablePackage,
  buildPublishArgs,
  emptyPublishAction,
  npmSupportsOidc,
  npmrcCandidates,
  publishAuthMode,
  publishFailureMessage,
  stripEmptyNpmAuth,
  tagMismatchMessage,
  versionRequiredByRef,
  withoutNpmTokens,
} from './publish-npm-lib.mjs';
import { packPublicArtifacts, verifyPublicArtifacts, runArtifactCommand } from './npm-artifacts.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const dryRun = process.env.NPM_PUBLISH_DRY_RUN === '1';
if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: publish-npm-packages.mjs [--check]');

function stripOidcNpmrc(env) {
  for (const filePath of npmrcCandidates(env, root)) {
    if (!existsSync(filePath)) continue;
    const original = readFileSync(filePath, 'utf8');
    const next = stripEmptyNpmAuth(original);
    if (next === original) continue;
    writeFileSync(filePath, next.endsWith('\n') || next.length === 0 ? next : `${next}\n`);
    console.log(`Removed empty npm auth token config from ${filePath} so OIDC can be used.`);
  }
}

const staging = mkdtempSync(join(tmpdir(), 'ppeng-npm-artifacts-'));
try {
  const versions = Object.fromEntries(['api-types', 'agent-loop'].map(name => [name, JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8')).version]));
  const mismatch = tagMismatchMessage(versionRequiredByRef(process.env.GITHUB_REF_TYPE, process.env.GITHUB_REF_NAME), versions);
  if (mismatch) throw new Error(mismatch);
  runArtifactCommand(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-b', 'packages/api-types', 'packages/agent-loop'], root);
  const artifacts = packPublicArtifacts(root, staging);
  for (const artifact of artifacts) assertPublishablePackage({ name: artifact.name, version: artifact.version });
  const evidence = verifyPublicArtifacts(root, staging, artifacts);
  mkdirSync(join(root, 'test-results'), { recursive: true });
  writeFileSync(join(root, 'test-results', 'npm-artifacts.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  if (!checkOnly) {
    const oidc = publishAuthMode(process.env) === 'oidc';
    let env = { ...process.env };
    if (oidc) {
      env = withoutNpmTokens(env);
      stripOidcNpmrc(env);
      const npmVersion = runArtifactCommand('npm', ['--version'], root, env).trim();
      if (!npmSupportsOidc(npmVersion)) throw new Error('npm >= 11.5.1 is required for trusted publishing. Refusing to publish.');
    } else {
      const token = env.NODE_AUTH_TOKEN || env.NPM_TOKEN;
      if (token) {
        const userconfig = join(staging, 'publish.npmrc');
        writeFileSync(userconfig, `//registry.npmjs.org/:_authToken=${token}\n`, { mode: 0o600 });
        env = { ...env, NPM_CONFIG_USERCONFIG: userconfig };
      }
    }
    if (!dryRun && !oidc) runArtifactCommand('npm', ['whoami', '--registry=https://registry.npmjs.org/'], root, env);
    const pending = [];
    for (const artifact of artifacts) {
      let published = '';
      try { published = runArtifactCommand('npm', ['view', `${artifact.name}@${artifact.version}`, 'version', '--registry=https://registry.npmjs.org/'], root, env).trim(); }
      catch (error) {
        if (!/E404|404 Not Found/.test(error.message)) throw error;
      }
      if (published === artifact.version) {
        console.log(`${artifact.name}@${artifact.version} already on npm; skipping`);
        continue;
      }
      pending.push(artifact);
    }
    const action = emptyPublishAction(pending.length, process.env.NPM_PUBLISH_IF_EXISTS === 'skip' ? 'skip' : 'fail');
    if (action === 'fail' && !dryRun) {
      throw new Error('All public packages are already published at this version. Run Publish npm with patch, minor, or major. An existing version cannot be replaced.');
    }
    if (action === 'publish') {
      for (const artifact of pending) {
        const planned = assertPublishablePackage({ name: artifact.name, version: artifact.version });
        const args = buildPublishArgs(artifact.tarball, planned.tag, { provenance: oidc && !dryRun, dryRun });
        try { console.log(runArtifactCommand('npm', args, root, env)); }
        catch (error) { throw new Error(`${error.message}\n${publishFailureMessage()}`); }
      }
    } else {
      console.log('Nothing new to publish.');
    }
    if (process.env.NPM_PUBLISH_ARTIFACT_DIR) {
      mkdirSync(process.env.NPM_PUBLISH_ARTIFACT_DIR, { recursive: true });
      for (const artifact of artifacts) cpSync(artifact.tarball, join(process.env.NPM_PUBLISH_ARTIFACT_DIR, basename(artifact.tarball)));
    }
  }
  console.log(checkOnly ? 'Package artifact verification passed (nothing published).' : dryRun ? 'Publish dry run passed.' : 'Published verified tarballs.');
} finally {
  rmSync(staging, { recursive: true, force: true });
}
