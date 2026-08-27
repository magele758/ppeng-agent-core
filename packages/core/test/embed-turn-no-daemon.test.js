/**
 * Phase 4: embed L3 turn kernel with a custom memory store.
 * No daemon listen, no RawAgentRuntime, no RAW_AGENT_AUTH_TOKEN.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createMemorySurfaceStore } from '../dist/session/index.js';
import { runTurnKernel } from '../dist/turn/index.js';

class ScriptedAdapter {
  constructor(handler) {
    this.name = 'scripted';
    this.handler = handler;
    this.calls = [];
  }
  async runTurn(input) {
    this.calls.push(input);
    return this.handler(input, this.calls.length);
  }
  async summarizeMessages() {
    return 'summary';
  }
}

test('runTurnKernel works without daemon listen or RAW_AGENT_AUTH_TOKEN', async () => {
  const prev = process.env.RAW_AGENT_AUTH_TOKEN;
  delete process.env.RAW_AGENT_AUTH_TOKEN;

  const originalListen = net.Server.prototype.listen;
  let listenCalls = 0;
  net.Server.prototype.listen = function listenSpy(...args) {
    listenCalls += 1;
    return originalListen.apply(this, args);
  };

  try {
    const store = createMemorySurfaceStore();
    const session = store.createSession({
      title: 'embed-turn',
      mode: 'chat',
      agentId: 'general'
    });
    store.appendMessage(session.id, 'user', [{ type: 'text', text: 'ping' }]);

    const echoTool = {
      name: 'echo',
      description: 'echo',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      approvalMode: 'never',
      sideEffectLevel: 'none',
      execute: async (_ctx, args) => ({ ok: true, content: String(args?.text ?? '') })
    };

    const adapter = new ScriptedAdapter((input) => {
      const hasToolResult = input.messages.some((m) =>
        m.parts.some((p) => p.type === 'tool_result')
      );
      if (!hasToolResult) {
        return {
          stopReason: 'tool_use',
          assistantParts: [
            {
              type: 'tool_call',
              toolCallId: 'echo1',
              name: 'echo',
              input: { text: 'hello-l3' }
            }
          ]
        };
      }
      return {
        stopReason: 'end',
        assistantParts: [{ type: 'text', text: 'done-l3' }]
      };
    });

    const record = await runTurnKernel({
      store,
      sessionId: session.id,
      model: adapter,
      tools: [echoTool]
    });

    assert.equal(record.status, 'idle');
    assert.equal(adapter.calls.length, 2);
    const folded = store.foldMessages(session.id);
    const texts = folded.flatMap((m) =>
      m.parts.flatMap((p) => {
        if (p.type === 'text') return [p.text];
        if (p.type === 'tool_result') return [p.content];
        return [];
      })
    );
    assert.ok(texts.includes('ping'));
    assert.ok(texts.includes('hello-l3'));
    assert.ok(texts.includes('done-l3'));
    assert.equal(process.env.RAW_AGENT_AUTH_TOKEN, undefined);
    assert.equal(listenCalls, 0);
  } finally {
    net.Server.prototype.listen = originalListen;
    if (prev === undefined) delete process.env.RAW_AGENT_AUTH_TOKEN;
    else process.env.RAW_AGENT_AUTH_TOKEN = prev;
  }
});
