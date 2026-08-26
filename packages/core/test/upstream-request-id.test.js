import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUpstreamRequestId,
  pickUpstreamRequestIdFromHeaders,
  pickUpstreamRequestIdFromJsonText,
  pickUpstreamRequestIdFromRecord,
  resolveUpstreamRequestId,
  unwrapNestedUpstreamError,
  wrapResponseToCaptureUpstreamRequestId
} from '../dist/model/upstream-request-id.js';

test('pickUpstreamRequestIdFromHeaders prefers x-request-id', () => {
  const h = new Headers({
    'x-maas-request-id': 'maas-1',
    'x-request-id': 'req-1'
  });
  assert.equal(pickUpstreamRequestIdFromHeaders(h), 'req-1');
});

test('pickUpstreamRequestIdFromHeaders falls back to x-maas-request-id', () => {
  const h = new Headers({ 'x-maas-request-id': 'maas-1' });
  assert.equal(pickUpstreamRequestIdFromHeaders(h), 'maas-1');
});

test('pickUpstreamRequestIdFromJsonText: error body request_id', () => {
  assert.equal(
    pickUpstreamRequestIdFromJsonText(
      JSON.stringify({ error: '配额不足', request_id: '1784167209139_4b01faee', error_code: '50007' })
    ),
    '1784167209139_4b01faee'
  );
});

test('pickUpstreamRequestIdFromJsonText: success id when no request_id', () => {
  assert.equal(
    pickUpstreamRequestIdFromJsonText(
      JSON.stringify({ id: 'chatcmpl-abc', object: 'chat.completion', choices: [] })
    ),
    'chatcmpl-abc'
  );
});

test('pickUpstreamRequestIdFromJsonText: request_id wins over id', () => {
  assert.equal(
    pickUpstreamRequestIdFromJsonText(JSON.stringify({ id: 'chatcmpl-abc', request_id: 'maas-rid' })),
    'maas-rid'
  );
});

test('pickUpstreamRequestIdFromJsonText: nested error string (gateway wrap)', () => {
  assert.equal(
    pickUpstreamRequestIdFromJsonText(
      JSON.stringify({
        error: '上游服务错误 {"error":"Rate limit exceeded","request_id":"1784268623829_e394feab"}'
      })
    ),
    '1784268623829_e394feab'
  );
});

test('pickUpstreamRequestIdFromJsonText: SSE data line', () => {
  const sse = 'data: {"id":"chatcmpl-stream-1","object":"chat.completion.chunk","choices":[]}\n\n';
  assert.equal(pickUpstreamRequestIdFromJsonText(sse), 'chatcmpl-stream-1');
});

test('pickUpstreamRequestIdFromRecord mirrors JSON object rules', () => {
  assert.equal(pickUpstreamRequestIdFromRecord({ id: 'chatcmpl-x', request_id: 'r-1' }), 'r-1');
  assert.equal(pickUpstreamRequestIdFromRecord({ id: 'chatcmpl-x' }), 'chatcmpl-x');
  assert.equal(pickUpstreamRequestIdFromRecord(null), undefined);
});

test('unwrapNestedUpstreamError: gateway wrap restores message + request_id', () => {
  const maasBody = JSON.stringify({
    error:
      '上游服务错误 {"error":"Rate limit exceeded","help":"Please contact customer support for assistance.","request_id":"1784268623829_e394feab"}'
  });
  assert.deepEqual(unwrapNestedUpstreamError(maasBody), {
    message: '上游服务错误: Rate limit exceeded',
    requestId: '1784268623829_e394feab',
    code: undefined
  });
});

test('unwrapNestedUpstreamError: flat body', () => {
  assert.deepEqual(
    unwrapNestedUpstreamError('{"error":"配额不足","error_code":"50007","request_id":"r-1"}'),
    { message: '配额不足', requestId: 'r-1', code: '50007' }
  );
});

test('unwrapNestedUpstreamError: plain text → all absent', () => {
  assert.deepEqual(unwrapNestedUpstreamError('Internal Server Error'), {
    message: undefined,
    requestId: undefined,
    code: undefined
  });
});

test('unwrapNestedUpstreamError: depth cap does not hang', () => {
  let body = '{"error":"innermost","request_id":"deep-rid"}';
  for (let i = 0; i < 6; i++) {
    body = JSON.stringify({ error: `wrap ${body}` });
  }
  const r = unwrapNestedUpstreamError(body);
  assert.equal(typeof r.message, 'string');
  assert.equal(r.requestId, undefined);
});

test('wrapResponseToCaptureUpstreamRequestId captures SSE id without dropping bytes', async () => {
  const payload = 'data: {"id":"chatcmpl-sse-9","choices":[{"delta":{"content":"hi"}}]}\n\n';
  const src = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload));
      controller.close();
    }
  });
  let captured;
  const wrapped = wrapResponseToCaptureUpstreamRequestId(
    new Response(src, { headers: { 'content-type': 'text/event-stream' } }),
    (id) => {
      captured = id;
    }
  );
  const text = await wrapped.text();
  assert.equal(text, payload);
  assert.equal(captured, 'chatcmpl-sse-9');
});

test('resolveUpstreamRequestId: headers win over body', () => {
  assert.equal(
    resolveUpstreamRequestId({
      headers: new Headers({ 'x-request-id': 'hdr-1' }),
      bodyRecord: { id: 'chatcmpl-body' }
    }),
    'hdr-1'
  );
});

test('resolveUpstreamRequestId: body fallback', () => {
  assert.equal(
    resolveUpstreamRequestId({
      headers: new Headers(),
      bodyText: JSON.stringify({ request_id: 'body-rid' })
    }),
    'body-rid'
  );
});

test('normalizeUpstreamRequestId ignores placeholders', () => {
  assert.equal(normalizeUpstreamRequestId('(无)'), undefined);
  assert.equal(normalizeUpstreamRequestId('  '), undefined);
  assert.equal(normalizeUpstreamRequestId('abc'), 'abc');
});
