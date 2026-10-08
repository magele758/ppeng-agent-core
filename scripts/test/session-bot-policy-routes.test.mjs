import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ANONYMOUS_AUTH, RawAgentRuntime } from '@ppeng/agent-core';
import { sessionsRoutes } from '../../apps/daemon/dist/routes/sessions.js';

const idleAdapter = {
  name: 'idle',
  async runTurn() {
    return { stopReason: 'end', assistantParts: [{ type: 'text', text: 'ok' }] };
  },
  async summarizeMessages() {
    return '';
  }
};

function makeRuntime() {
  return new RawAgentRuntime({
    repoRoot: mkdtempSync(join(tmpdir(), 'sbp-repo-')),
    stateDir: mkdtempSync(join(tmpdir(), 'sbp-state-')),
    modelAdapter: idleAdapter
  });
}

async function call(runtime, method, pattern, params, body) {
  const route = sessionsRoutes(runtime).find((r) => r.method === method && r.pattern === pattern);
  assert.ok(route, `${method} ${pattern}`);
  const out = { status: 200, body: undefined };
  const response = {
    statusCode: 200,
    setHeader() {},
    end(text) {
      out.status = this.statusCode;
      out.body = text ? JSON.parse(text) : undefined;
    }
  };
  try {
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
  } catch (error) {
    return { status: error.statusCode ?? 500, message: error.message };
  }
  return out;
}

test('POST /api/sessions with botId rejects permission / tool / skill metadata and leaves the bot untouched', async () => {
  const rt = makeRuntime();
  const bot = rt.createBot({ name: 'Guarded' });
  rt.mergeSessionMetadata(bot.canonicalSessionId, { permissionMode: 'ask', allowedTools: ['TodoWrite'] });
  const before = rt.getSession(bot.canonicalSessionId).metadata;

  for (const metadata of [
    { permissionMode: 'bypass' },
    { permissionMode: null },
    { allowedTools: [] },
    { allowedSkills: [] },
    { allowedSkills: ['x'], maxTurns: 24 }
  ]) {
    const res = await call(rt, 'POST', '/api/sessions', {}, { botId: bot.id, autoRun: false, metadata });
    assert.equal(res.status, 400, JSON.stringify(metadata));
    assert.match(res.message, /PATCH \/api\/bots\/:id/);
    assert.match(res.message, /PATCH \/api\/sessions\/:id/);
  }
  const after = rt.getSession(bot.canonicalSessionId).metadata;
  assert.equal(after.permissionMode, before.permissionMode);
  assert.deepEqual(after.allowedTools, before.allowedTools);
  assert.deepEqual(after.allowedSkills, before.allowedSkills);
});

test('POST /api/sessions with botId still accepts maxTurns and works without metadata; plain sessions are unchanged', async () => {
  const rt = makeRuntime();
  const bot = rt.createBot({ name: 'Plain' });
  const ok = await call(rt, 'POST', '/api/sessions', {}, { botId: bot.id, autoRun: false, metadata: { maxTurns: 48 } });
  assert.equal(ok.status, 201);
  assert.equal(rt.getSession(bot.canonicalSessionId).metadata.maxTurns, 48);
  const bad = await call(rt, 'POST', '/api/sessions', {}, { botId: bot.id, autoRun: false, metadata: { maxTurns: 25 } });
  assert.equal(bad.status, 400);

  const plain = await call(
    rt,
    'POST',
    '/api/sessions',
    {},
    { autoRun: false, metadata: { permissionMode: 'plan', allowedTools: ['bash'] } }
  );
  assert.equal(plain.status, 201);
  assert.equal(plain.body.session.metadata.permissionMode, 'plan');
  assert.deepEqual(plain.body.session.metadata.allowedTools, ['bash']);
});

test('PATCH /api/sessions/:id needs confirmBypass: true to reach bypass, but not for other tiers [AC:bots#AC-5]', async () => {
  const rt = makeRuntime();
  const session = rt.createChatSession({ title: 't', metadata: { permissionMode: 'auto' } });
  const patch = (data) => call(rt, 'PATCH', '/api/sessions/:id', { id: session.id }, data);
  const mode = () => rt.getSession(session.id).metadata.permissionMode;

  for (const data of [
    { permissionMode: 'bypass' },
    { permissionMode: 'bypass', confirmBypass: false },
    { permissionMode: 'bypass', confirmBypass: 'true' },
    { shiftPermission: 'elevate' }
  ]) {
    const res = await patch(data);
    assert.equal(res.status, 400, JSON.stringify(data));
    assert.match(res.message, /confirmBypass/);
    assert.equal(mode(), 'auto');
  }
  assert.equal((await patch({ permissionMode: null })).status, 400);
  assert.equal(mode(), 'auto');

  assert.equal((await patch({ permissionMode: 'ask' })).status, 200);
  assert.equal((await patch({ permissionMode: 'auto' })).status, 200);
  assert.equal((await patch({ shiftPermission: 'elevate', confirmBypass: true })).status, 200);
  assert.equal(mode(), 'bypass');
  assert.equal((await patch({ permissionMode: 'auto' })).status, 200);
  assert.equal(mode(), 'auto');
  assert.equal((await patch({ permissionMode: 'bypass', confirmBypass: true })).status, 200);
  assert.equal(mode(), 'bypass');
});

test('POST /api/sessions/:id/permission applies the same bypass confirmation', async () => {
  const rt = makeRuntime();
  const session = rt.createChatSession({ title: 't', metadata: { permissionMode: 'ask' } });
  const post = (data) => call(rt, 'POST', '/api/sessions/:id/permission', { id: session.id }, data);
  assert.equal((await post({ mode: 'bypass' })).status, 400);
  assert.equal(rt.getSession(session.id).metadata.permissionMode, 'ask');
  assert.equal((await post({ mode: 'bypass', confirmBypass: true })).status, 200);
  assert.equal(rt.getSession(session.id).metadata.permissionMode, 'bypass');
});
