import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOT_MODEL_FOLLOW_DEFAULT,
  botModelPickable,
  botModelPinIsStale,
  botModelSelectValue,
  parseBotModelOverride
} from './bot-model.ts';
import type { ModelPickerOption } from './model-providers.ts';

const opt = (providerId: string, modelId: string, source: ModelPickerOption['source'] = 'ui'): ModelPickerOption => ({
  providerId,
  providerName: providerId,
  modelId,
  kind: 'openai-compatible',
  source
});

test('parseBotModelOverride reads a well-formed pin and ignores everything else', () => {
  assert.deepEqual(parseBotModelOverride({ modelOverride: { providerId: 'a', modelId: 'm' } }), {
    providerId: 'a',
    modelId: 'm'
  });
  assert.equal(parseBotModelOverride(undefined), null);
  assert.equal(parseBotModelOverride({}), null);
  assert.equal(parseBotModelOverride({ modelRef: { providerId: 'a', modelId: 'm' } }), null);
  assert.equal(parseBotModelOverride({ modelOverride: 'gpt-x' }), null);
  assert.equal(parseBotModelOverride({ modelOverride: { providerId: 'a' } }), null);
});

test('botModelSelectValue maps no pin to follow-default', () => {
  assert.equal(botModelSelectValue(null), BOT_MODEL_FOLLOW_DEFAULT);
  assert.equal(botModelSelectValue({ providerId: 'a', modelId: 'm' }), 'a::m');
});

test('picker never offers the env fallback; a pin outside the list is stale', () => {
  const options = [opt('a', 'm1'), opt('__env__', 'env-model', 'env')];
  assert.deepEqual(
    botModelPickable(options).map((o) => o.modelId),
    ['m1']
  );
  assert.equal(botModelPinIsStale(null, options), false);
  assert.equal(botModelPinIsStale({ providerId: 'a', modelId: 'm1' }, options), false);
  assert.equal(botModelPinIsStale({ providerId: 'a', modelId: 'gone' }, options), true);
  assert.equal(botModelPinIsStale({ providerId: '__env__', modelId: 'env-model' }, options), true);
});
