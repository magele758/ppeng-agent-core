import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGatewayPatch,
  draftFromView,
  isGatewayDirty,
  parseSenderList,
  type GatewaySettingsView
} from './gateway-settings.ts';

const view: GatewaySettingsView = {
  feishu: { verificationTokenSet: true, encryptKeySet: false, allowedSenders: ['ou_a'], botId: 'bot-1' },
  wecom: { bridgeSecretSet: false, allowedSenders: [] },
  webhook: { allowedSenders: [] }
};

test('parseSenderList splits on newline/comma and dedupes', () => {
  assert.deepEqual(parseSenderList('ou_a, ou_b\nou_a；ou_c'), ['ou_a', 'ou_b', 'ou_c']);
  assert.deepEqual(parseSenderList('  '), []);
});

test('untouched draft produces an empty patch and is not dirty [AC:settings-models-onboarding#AC-7]', () => {
  const draft = draftFromView(view);
  assert.deepEqual(buildGatewayPatch(view, draft), {});
  assert.equal(isGatewayDirty(view, draft), false);
});

test('patch only carries changed fields and never an empty secret [AC:settings-models-onboarding#AC-8]', () => {
  const draft = draftFromView(view);
  draft.feishu.encryptKey = ' enc-key ';
  draft.wecom.allowedSenders = 'u1, u2';
  assert.deepEqual(buildGatewayPatch(view, draft), {
    feishu: { encryptKey: 'enc-key' },
    wecom: { allowedSenders: ['u1', 'u2'] }
  });
  assert.equal(isGatewayDirty(view, draft), true);
});

test('clearing a secret or botId sends null; blank secret input keeps it [AC:settings-models-onboarding#AC-8]', () => {
  const draft = draftFromView(view);
  draft.feishu.clearVerificationToken = true;
  draft.feishu.botId = '';
  assert.deepEqual(buildGatewayPatch(view, draft), {
    feishu: { verificationToken: null, botId: null }
  });
  const keep = draftFromView(view);
  keep.feishu.verificationToken = '   ';
  assert.deepEqual(buildGatewayPatch(view, keep), {});
});
