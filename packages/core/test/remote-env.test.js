import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatRemoteEnvInspection,
  inspectRemoteEnv,
  normalizeRemoteSecret
} from '../dist/model/remote-env.js';
import { OpenAICompatibleAdapter } from '../dist/model/model-adapters.js';

test('normalizeRemoteSecret strips whitespace, quotes, and Bearer prefix', () => {
  assert.equal(normalizeRemoteSecret('  sk-abc  \n'), 'sk-abc');
  assert.equal(normalizeRemoteSecret('"sk-abc"'), 'sk-abc');
  assert.equal(normalizeRemoteSecret("'sk-abc'"), 'sk-abc');
  assert.equal(normalizeRemoteSecret('Bearer sk-abc'), 'sk-abc');
  assert.equal(normalizeRemoteSecret('bearer  sk-abc'), 'sk-abc');
  assert.equal(normalizeRemoteSecret('  "Bearer sk-abc"\n'), 'sk-abc');
  assert.equal(normalizeRemoteSecret(''), '');
});

test('inspectRemoteEnv never echoes secrets and flags paste mistakes', () => {
  const info = inspectRemoteEnv({
    RAW_AGENT_API_KEY: '  "Bearer sk-secret-do-not-log"\n',
    RAW_AGENT_BASE_URL: ' https://api.example.com/v1 \n',
    RAW_AGENT_MODEL_NAME: ' gpt-x '
  });
  assert.equal(info.keyHadWhitespace, true);
  assert.equal(info.keyHadQuotes, true);
  assert.equal(info.keyHadBearerPrefix, true);
  assert.equal(info.baseUrlHasV1, true);
  assert.equal(info.baseUrlHadWhitespace, true);
  assert.equal(info.modelHadWhitespace, true);
  const text = formatRemoteEnvInspection(info);
  assert.equal(text.includes('sk-secret'), false);
  assert.equal(text.includes('example.com'), false);
  assert.match(text, /key_bearer=true/);
  assert.match(text, /base_has_v1=true/);
});

test('OpenAICompatibleAdapter constructor normalizes pasted secrets', async () => {
  const urls = [];
  const headers = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    urls.push(String(url));
    headers.push(init?.headers);
    return {
      ok: true,
      headers: new Headers(),
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }]
        })
    };
  };
  try {
    const adapter = new OpenAICompatibleAdapter({
      apiKey: 'Bearer sk-trimmed\n',
      baseUrl: 'https://api.example.com/v1\n',
      model: ' m ',
      useJsonMode: false
    });
    await adapter.completeText({ system: 's', user: 'u' });
    assert.equal(urls[0], 'https://api.example.com/v1/chat/completions');
    assert.equal(headers[0].authorization, 'Bearer sk-trimmed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
