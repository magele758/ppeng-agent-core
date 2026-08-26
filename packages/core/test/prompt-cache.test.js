import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fingerprintToolNames,
  resolveToolsetLock,
  TOOLSET_LOCK_META_KEY
} from '../dist/session/prompt-cache.js';

test('fingerprintToolNames is order-independent', () => {
  assert.equal(fingerprintToolNames(['b', 'a']), fingerprintToolNames(['a', 'b']));
});

test('resolveToolsetLock locks on first call', () => {
  const r = resolveToolsetLock('sess1', ['bash', 'read_file'], {});
  assert.equal(r.drifted, false);
  assert.ok(r.metadataPatch[TOOLSET_LOCK_META_KEY]);
  assert.ok(r.promptCacheKey.startsWith('ppeng:sess1:'));
});

test('resolveToolsetLock detects drift', () => {
  const first = resolveToolsetLock('sess1', ['bash'], {});
  const second = resolveToolsetLock('sess1', ['bash', 'write_file'], {
    [TOOLSET_LOCK_META_KEY]: first.fingerprint
  });
  assert.equal(second.drifted, true);
  assert.ok(second.metadataPatch.promptCacheBustedAt);
});
