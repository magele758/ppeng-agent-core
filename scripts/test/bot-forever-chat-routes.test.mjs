import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ANONYMOUS_AUTH, RawAgentRuntime } from '@ppeng/agent-core';
import { sessionsRoutes } from '../../apps/daemon/dist/routes/sessions.js';

function makeRuntime() {
  return new RawAgentRuntime({
    repoRoot: mkdtempSync(join(tmpdir(), 'bfc-route-repo-')),
    stateDir: mkdtempSync(join(tmpdir(), 'bfc-route-state-')),
    modelAdapter: {
      name: 'stub',
      calls: 0,
      async runTurn() {
        this.calls += 1;
        return { stopReason: 'end', assistantParts: [{ type: 'text', text: 'ok' }] };
      },
      async summarizeMessages() {
        return 'COMPACTED-SUMMARY';
      }
    }
  });
}

async function call(runtime, method, pattern, params, body) {
  const route = sessionsRoutes(runtime).find((item) => item.method === method && item.pattern === pattern);
  assert.ok(route, `${method} ${pattern}`);
  const out = { status: 200, body: undefined, raw: '' };
  const response = {
    statusCode: 200,
    setHeader() {},
    end(text) {
      out.status = this.statusCode;
      out.raw = text ? String(text) : '';
      try {
        out.body = out.raw ? JSON.parse(out.raw) : undefined;
      } catch {
        out.body = undefined;
      }
    }
  };
  await route.handler({
    request: { method, headers: {} },
    response,
    url: new URL(`http://x${pattern}`),
    parts: [],
    params,
    requireParam: (name) => params[name],
    readBody: async () => body,
    auth: ANONYMOUS_AUTH
  });
  return out;
}

function seedTurns(store, sessionId) {
  store.appendMessage(sessionId, 'user', [{ type: 'text', text: 'question-0' }]);
  store.appendMessage(sessionId, 'assistant', [{ type: 'text', text: 'answer-0' }]);
  store.appendMessage(sessionId, 'user', [{ type: 'text', text: 'question-1' }]);
  store.appendMessage(sessionId, 'assistant', [{ type: 'text', text: 'answer-1' }]);
}

test('Lab 向 Bot 固定对话发送 /new 不新开会话 [AC:bot-forever-chat#AC-1] [AC:bot-forever-chat#AC-4]', async () => {
  const rt = makeRuntime();
  const bot = rt.createBot({ name: 'LabBot' });
  const sid = bot.canonicalSessionId;
  seedTurns(rt.store, sid);
  const idsBefore = rt.listSessions().map((session) => session.id);

  const posted = await call(rt, 'POST', '/api/sessions/:id/messages', { id: sid }, { message: '/new', autoRun: true });
  const streamed = await call(rt, 'POST', '/api/sessions/:id/stream', { id: sid }, { message: '/stop' });
  const model = await call(rt, 'POST', '/api/chat', {}, { botId: bot.id, message: '/model heuristic/heuristic' });

  assert.equal(posted.status, 200);
  assert.equal(posted.body?.command?.code, 'compacted');
  assert.equal(posted.body?.session?.id, sid);
  assert.equal(streamed.body?.command?.code, 'stopped');
  assert.equal(streamed.body?.session?.id, sid);
  assert.equal(model.body?.command?.code, 'model_set');
  assert.equal(model.body?.session?.id, sid);
  assert.deepEqual(rt.getSession(sid).metadata.modelOverride, { providerId: 'heuristic', modelId: 'heuristic' });
  assert.deepEqual(
    rt.listSessions().map((session) => session.id).sort(),
    [...idsBefore].sort()
  );
  assert.equal(rt.modelAdapter.calls, 0);
  assert.match(rt.getSession(sid).summary ?? '', /COMPACTED-SUMMARY/);
});

test('未选中 Bot 时 /new 不会压缩 Bot 对话 [AC:bot-forever-chat#AC-6]', async () => {
  const rt = makeRuntime();
  const bot = rt.createBot({ name: 'Other' });
  seedTurns(rt.store, bot.canonicalSessionId);
  const plain = rt.createChatSession({ title: 'plain', message: 'hello', background: false });

  const res = await call(rt, 'POST', '/api/sessions/:id/messages', { id: plain.id }, { message: '/new', autoRun: false });

  assert.equal(res.body?.command, undefined);
  assert.equal(rt.getSession(bot.canonicalSessionId).summary ?? '', '');
  assert.ok(rt.getSessionMessages(plain.id).some((message) => message.role === 'user' && JSON.stringify(message.parts).includes('/new')));
});
