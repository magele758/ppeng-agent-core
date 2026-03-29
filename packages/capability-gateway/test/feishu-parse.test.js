import assert from 'node:assert';
import { test } from 'node:test';
import { extractFeishuInboundText, feishuUrlVerificationResponse } from '../dist/im-handlers.js';

test('feishu url_verification', () => {
  const r = feishuUrlVerificationResponse({ type: 'url_verification', challenge: 'abc' });
  assert.deepStrictEqual(r, { challenge: 'abc' });
});

test('feishu extract group text', () => {
  const body = {
    header: { event_type: 'im.message.receive_v1' },
    event: {
      message: {
        chat_id: 'oc_xxx',
        chat_type: 'group',
        message_type: 'text',
        content: '{"text":"hello"}'
      },
      sender: { sender_id: { open_id: 'ou_1' } }
    }
  };
  const x = extractFeishuInboundText(body);
  assert.ok(x);
  assert.equal(x.text, 'hello');
  assert.equal(x.receiveIdType, 'chat_id');
  assert.equal(x.receiveId, 'oc_xxx');
});
