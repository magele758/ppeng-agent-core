import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAiResponsesAdapter } from '../../packages/agent-loop/dist/model/model-adapters.js';
import { OpenAICompatibleAdapter } from '../../packages/core/dist/model/model-adapters.js';

const input = { agent: { id: 'a', name: 'a', role: 'test', instructions: '', capabilities: [] }, systemPrompt: 'system',
  messages: [{ id: 'm', sessionId: 's', role: 'user', parts: [{ type: 'text', text: 'hello' }], createdAt: 'now', seq: 1 }], tools: [] };
function stream(events, size = 3) {
  const bytes = new TextEncoder().encode(events.map(event => typeof event === 'string' ? event : `data: ${JSON.stringify(event)}\r\n\r\n`).join(''));
  let index = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (index >= bytes.length) return controller.close();
    controller.enqueue(bytes.slice(index, index + size)); index += size;
  } }), { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'protocol-test-request' } });
}
const message = text => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const terminal = (type = 'response.completed', response = {}) => ({ type, response: { status: 'completed', output: [message('你好')], usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 }, ...response } });

for (const [name, create] of [
  ['SDK', () => new OpenAiResponsesAdapter({ apiKey: 'fixture', baseUrl: 'https://fixture.invalid/v1', model: 'fixture', useJsonMode: false })],
  ['core', () => new OpenAICompatibleAdapter({ apiKey: 'fixture', baseUrl: 'https://fixture.invalid/v1', model: 'fixture', useJsonMode: false, httpKind: 'responses' })]
]) {
  test(`${name}: fragmented UTF-8, CRLF, malformed/unknown events, duplicate terminal snapshot do not duplicate text`, async t => {
    t.mock.method(globalThis, 'fetch', async () => stream([
      ': keepalive\r\n\r\n', 'data: {invalid}\r\n\r\n', { type: 'response.future_event' },
      { type: 'response.output_text.delta', delta: '你' }, { type: 'response.output_text.delta', delta: '好' },
      { type: 'response.output_text.done', text: '你好' }, terminal(), terminal(), 'data: [DONE]'
    ], 1));
    const chunks = [], got = await create().runTurnStream(input, c => chunks.push(c));
    assert.equal(got.assistantParts.filter(p => p.type === 'text').map(p => p.text).join(''), '你好');
    assert.equal(chunks.filter(c => c.type === 'text_delta').map(c => c.text).join(''), '你好');
    assert.equal(got.usage.totalTokens, 10);
    assert.equal(got.requestId, 'protocol-test-request');
  });

  test(`${name}: interleaved function arguments pair item IDs with call IDs exactly once`, async t => {
    t.mock.method(globalThis, 'fetch', async () => stream([
      { type: 'response.output_item.added', item: { type: 'function_call', id: 'item1', call_id: 'call1', name: 'lookup', arguments: '' } },
      { type: 'response.output_item.added', item: { type: 'function_call', id: 'item2', call_id: 'call2', name: 'save', arguments: '' } },
      { type: 'response.function_call_arguments.delta', item_id: 'item1', delta: '{"key":' },
      { type: 'response.function_call_arguments.delta', item_id: 'item2', delta: '{"value":42}' },
      { type: 'response.function_call_arguments.delta', item_id: 'item1', delta: '"你好"}' },
      { type: 'response.function_call_arguments.done', item_id: 'item1', arguments: '{"key":"你好"}' },
      'data: [DONE]\n\n'
    ]));
    const got = await create().runTurnStream(input, () => {});
    const calls = got.assistantParts.filter(p => p.type === 'tool_call');
    assert.equal(got.stopReason, 'tool_use');
    assert.deepEqual(calls.map(c => [c.toolCallId, c.name, c.input]), [['call1', 'lookup', { key: '你好' }], ['call2', 'save', { value: 42 }]]);
  });

  test(`${name}: incomplete terminal preserves partial text, usage, finish reason and truncation`, async t => {
    t.mock.method(globalThis, 'fetch', async () => stream([terminal('response.incomplete', {
      status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [message('partial')]
    })]));
    const got = await create().runTurnStream(input, () => {});
    assert.equal(got.assistantParts.find(p => p.type === 'text').text, 'partial');
    assert.equal(got.truncated, true);
    assert.equal(got.finishReason, 'max_output_tokens');
    assert.equal(got.usage.totalTokens, 10);
  });

  test(`${name}: failed/cancelled terminal events cannot appear as successful empty output`, async t => {
    for (const type of ['response.failed', 'response.cancelled']) {
      const mock = t.mock.method(globalThis, 'fetch', async () => stream([terminal(type, { status: type.slice(9), output: [] })]));
      await assert.rejects(create().runTurnStream(input, () => {}), /failed|cancelled/);
      mock.mock.restore();
    }
  });

  test(`${name}: HTTP failures are propagated without adapter-level retry and include request ID`, async t => {
    for (const status of [429, 503]) {
      const mock = t.mock.method(globalThis, 'fetch', async () => new Response('{"error":"fixture failure"}', { status, headers: { 'x-request-id': 'failure-id' } }));
      await assert.rejects(create().runTurnStream(input, () => {}), new RegExp(`${status}.*failure-id`));
      assert.equal(mock.mock.callCount(), 1); mock.mock.restore();
    }
  });

  test(`${name}: cancellation reaches fetch and does not become a fabricated completion`, async t => {
    const controller = new AbortController(); controller.abort();
    t.mock.method(globalThis, 'fetch', async (_url, options) => { assert.equal(options.signal, controller.signal); options.signal.throwIfAborted(); });
    await assert.rejects(create().runTurnStream({ ...input, signal: controller.signal }, () => {}), { name: 'AbortError' });
  });
}
