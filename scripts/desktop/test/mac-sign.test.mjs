import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adHocCodesignArgs } from '../../lib/desktop-mac-sign.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('ad-hoc codesign uses unsigned identity and no timestamp', () => {
  assert.deepEqual(adHocCodesignArgs('/tmp/Raw Agent.app'), [
    '--force',
    '--deep',
    '--sign',
    '-',
    '--timestamp=none',
    '/tmp/Raw Agent.app'
  ]);
});

test('unsigned Mac pack disables hardenedRuntime and runs afterPack', () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'apps', 'desktop', 'package.json'), 'utf8'));
  assert.equal(pkg.build.mac.identity, null);
  assert.equal(pkg.build.mac.hardenedRuntime, false);
  assert.equal(pkg.build.afterPack, './after-pack.cjs');
});
