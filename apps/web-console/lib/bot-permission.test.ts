import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOT_PERMISSION_MODES,
  needsBypassConfirm,
  parseBotPermissionMode,
  parseBotPolicyWarnings
} from './bot-permission.ts';

test('parseBotPermissionMode keeps every legal tier and defaults the rest to auto', () => {
  for (const mode of BOT_PERMISSION_MODES) assert.equal(parseBotPermissionMode(mode), mode);
  for (const bad of [undefined, null, '', 'Bypass', 'full', 3]) {
    assert.equal(parseBotPermissionMode(bad), 'auto');
  }
});

test('needsBypassConfirm only fires when entering bypass', () => {
  for (const from of BOT_PERMISSION_MODES) {
    for (const to of BOT_PERMISSION_MODES) {
      assert.equal(needsBypassConfirm(from, to), to === 'bypass' && from !== 'bypass', `${from}->${to}`);
    }
  }
});

test('parseBotPolicyWarnings keeps only well-formed warnings', () => {
  assert.deepEqual(parseBotPolicyWarnings(undefined), []);
  assert.deepEqual(
    parseBotPolicyWarnings([
      { code: 'missing_required_tools', tools: ['TodoWrite', 7, 'load_skill'] },
      { code: 'other', tools: [] },
      null
    ]),
    [{ code: 'missing_required_tools', tools: ['TodoWrite', 'load_skill'] }]
  );
});
