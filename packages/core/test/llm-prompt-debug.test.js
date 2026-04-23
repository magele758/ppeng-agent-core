import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeLlmRequestBodyForDebug } from '../dist/model/llm-prompt-debug.js';

test('sanitizeLlmRequestBodyForDebug truncates base64 data urls', () => {
  const longB64 = 'data:image/png;base64,' + 'x'.repeat(200);
  const out = sanitizeLlmRequestBodyForDebug(
    {
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'hi' }, { type: 'image_url', image_url: { url: longB64 } }]
        }
      ]
    },
    {}
  );
  const content = out.messages[0].content;
  assert.match(content[1].image_url.url, /BASE64_TRUNCATED/);
});

test('sanitizeLlmRequestBodyForDebug respects RAW_AGENT_DEBUG_LLM_PROMPT_MAX_CHARS', () => {
  const out = sanitizeLlmRequestBodyForDebug(
    { messages: [{ role: 'user', content: 'abcdefghij' }] },
    { RAW_AGENT_DEBUG_LLM_PROMPT_MAX_CHARS: '4' }
  );
  assert.match(out.messages[0].content, /TRUNCATED/);
});
