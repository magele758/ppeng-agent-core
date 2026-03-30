import test from 'node:test';
import assert from 'node:assert/strict';
import { HybridModelRouterAdapter } from '../dist/model-adapters.js';

class RecorderAdapter {
  constructor(name, reply) {
    this.name = name;
    this.reply = reply;
    this.lastInput = null;
  }
  async runTurn(input) {
    this.lastInput = input;
    return this.reply;
  }
  async summarizeMessages() {
    return 's';
  }
}

test('HybridModelRouterAdapter routes to VL when messages contain an image part', async () => {
  const text = new RecorderAdapter('text', { stopReason: 'end', assistantParts: [{ type: 'text', text: 'text' }] });
  const vl = new RecorderAdapter('vl', { stopReason: 'end', assistantParts: [{ type: 'text', text: 'vl' }] });
  const router = new HybridModelRouterAdapter(text, vl, 'any');
  const base = {
    agent: { id: 'main', name: 'Main', role: 'r', instructions: '', capabilities: [] },
    systemPrompt: 'sys',
    tools: [],
    messages: [
      {
        id: 'm1',
        sessionId: 's',
        role: 'user',
        parts: [{ type: 'text', text: 'hi' }],
        createdAt: '2020-01-01T00:00:00.000Z'
      }
    ]
  };
  await router.runTurn(base);
  assert.equal(text.lastInput, base);
  assert.ok(!vl.lastInput);

  const withImg = {
    ...base,
    messages: [
      {
        id: 'm2',
        sessionId: 's',
        role: 'user',
        parts: [
          { type: 'text', text: 'see' },
          { type: 'image', assetId: 'img_1', mimeType: 'image/png' }
        ],
        createdAt: '2020-01-01T00:00:00.000Z'
      }
    ]
  };
  await router.runTurn(withImg);
  assert.equal(vl.lastInput, withImg);
});

test('HybridModelRouterAdapter last_user scope ignores images only in older turns', async () => {
  const text = new RecorderAdapter('text', { stopReason: 'end', assistantParts: [{ type: 'text', text: 't' }] });
  const vl = new RecorderAdapter('vl', { stopReason: 'end', assistantParts: [{ type: 'text', text: 'v' }] });
  const router = new HybridModelRouterAdapter(text, vl, 'last_user');
  const input = {
    agent: { id: 'main', name: 'Main', role: 'r', instructions: '', capabilities: [] },
    systemPrompt: 's',
    tools: [],
    messages: [
      {
        id: 'a',
        sessionId: 's',
        role: 'user',
        parts: [
          { type: 'text', text: 'old' },
          { type: 'image', assetId: 'i1', mimeType: 'image/png' }
        ],
        createdAt: '2020-01-01T00:00:00.000Z'
      },
      {
        id: 'b',
        sessionId: 's',
        role: 'user',
        parts: [{ type: 'text', text: 'new text only' }],
        createdAt: '2020-01-02T00:00:00.000Z'
      }
    ]
  };
  await router.runTurn(input);
  assert.equal(text.lastInput, input);
});
