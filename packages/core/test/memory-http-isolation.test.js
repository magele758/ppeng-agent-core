/**
 * Memory HTTP read routes under auth.isolate (daemon routes, driven without a socket).
 * Lives in core/test so it runs with `npm run test:unit` after daemon tsc.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RawAgentRuntime } from '../dist/runtime.js';
import { saveSemanticFact } from '../dist/memory/memory-writer.js';
import { memoryRoutes } from '../../../apps/daemon/dist/routes/memory.js';

const ANON = { isolate: false, labProxy: false, user: null };
const asUser = (id) => ({ isolate: true, labProxy: true, user: { id, tenantId: 'default' } });

function makeRuntime() {
  return new RawAgentRuntime({
    repoRoot: mkdtempSync(join(tmpdir(), 'mem-http-repo-')),
    stateDir: mkdtempSync(join(tmpdir(), 'mem-http-state-')),
    modelAdapter: { name: 'noop', async runTurn() { return { stopReason: 'end', assistantParts: [] }; }, async summarizeMessages() { return ''; } }
  });
}

async function call(runtime, method, pattern, { auth, query = '', body } = {}) {
  const spec = memoryRoutes(runtime).find((r) => r.method === method && r.pattern === pattern);
  assert.ok(spec, `route ${method} ${pattern}`);
  let status = 200;
  let payload;
  const response = {
    statusCode: 200,
    setHeader() {},
    end(text) {
      status = this.statusCode;
      payload = text ? JSON.parse(text) : undefined;
    }
  };
  try {
    await spec.handler({
      request: {},
      response,
      url: new URL(`http://x${pattern}${query}`),
      parts: pattern.split('/').filter(Boolean),
      params: {},
      requireParam: () => '',
      readBody: async () => body ?? {},
      auth
    });
  } catch (error) {
    return { error };
  }
  return { status, payload };
}

function seed(runtime) {
  const am = runtime.store.agentMemory();
  const put = (userId, key, value, extra = {}) =>
    am.set({
      scope: 'user.memory', namespace: 'default', key, value, userId,
      importance: 0.9, confidence: 'medium', source: 'user_provided', ...extra
    });
  put('u1', 'k1', '用户一的蓝色笔记');
  put('u2', 'k2', '用户二的红色笔记');
  saveSemanticFact(am, { userId: 'u1', category: 'fact', content: '用户一的蓝色笔记事实' });
  saveSemanticFact(am, { userId: 'u2', category: 'fact', content: '用户二的红色笔记事实' });
  const s1 = runtime.store.createSession({ title: 's1', mode: 'chat', agentId: 'general', metadata: { userId: 'u1' } });
  const s2 = runtime.store.createSession({ title: 's2', mode: 'chat', agentId: 'general', metadata: { userId: 'u2' } });
  return { s1, s2 };
}

test('GET /api/memory: isolate forces the logged-in user; other modes keep the requested userId', async () => {
  const runtime = makeRuntime();
  const { s2 } = seed(runtime);

  const own = await call(runtime, 'GET', '/api/memory', { auth: asUser('u1'), query: '?scope=user.memory' });
  assert.deepEqual([...new Set(own.payload.entries.map((e) => e.userId))], ['u1']);

  const spoof = await call(runtime, 'GET', '/api/memory', { auth: asUser('u1'), query: '?scope=user.memory&userId=u2' });
  assert.deepEqual([...new Set(spoof.payload.entries.map((e) => e.userId))], ['u1']);
  assert.equal(JSON.stringify(spoof.payload).includes('红色'), false);

  const foreignSession = await call(runtime, 'GET', '/api/memory', { auth: asUser('u1'), query: `?sessionId=${s2.id}` });
  assert.equal(foreignSession.error?.name, 'NotFoundError');

  const open = await call(runtime, 'GET', '/api/memory', { auth: ANON, query: '?scope=user.memory&userId=u2' });
  assert.deepEqual([...new Set(open.payload.entries.map((e) => e.userId))], ['u2']);
  const all = await call(runtime, 'GET', '/api/memory', { auth: ANON, query: '?scope=user.memory' });
  assert.deepEqual([...new Set(all.payload.entries.map((e) => e.userId))].sort(), ['u1', 'u2']);
});

test('GET /api/memory/observations: isolate forces the user and guards the session', async () => {
  const runtime = makeRuntime();
  const { s1, s2 } = seed(runtime);
  const own = await call(runtime, 'GET', '/api/memory/observations', { auth: asUser('u1'), query: `?sessionId=${s1.id}` });
  assert.equal(own.status, 200);
  const foreign = await call(runtime, 'GET', '/api/memory/observations', { auth: asUser('u1'), query: `?sessionId=${s2.id}` });
  assert.equal(foreign.error?.name, 'NotFoundError');
  const open = await call(runtime, 'GET', '/api/memory/observations', { auth: ANON, query: `?sessionId=${s2.id}` });
  assert.equal(open.status, 200);
});

test('POST /api/memory/preview: guards the body sessionId and ignores a foreign userId under isolate', async () => {
  const runtime = makeRuntime();
  const { s1, s2 } = seed(runtime);

  const foreign = await call(runtime, 'POST', '/api/memory/preview', {
    auth: asUser('u1'), body: { sessionId: s2.id, query: '笔记' }
  });
  assert.equal(foreign.error?.name, 'NotFoundError');

  const spoof = await call(runtime, 'POST', '/api/memory/preview', {
    auth: asUser('u1'), body: { sessionId: 'preview-x', userId: 'u2', query: '笔记' }
  });
  assert.equal(spoof.status, 200);
  assert.equal(spoof.payload.appendix.includes('红色笔记'), false);
  assert.ok(spoof.payload.appendix.includes('蓝色笔记'));

  const ownSession = await call(runtime, 'POST', '/api/memory/preview', {
    auth: asUser('u1'), body: { sessionId: s1.id, userId: 'u2', query: '笔记' }
  });
  assert.equal(ownSession.status, 200);
  assert.equal(ownSession.payload.appendix.includes('红色笔记'), false);

  const open = await call(runtime, 'POST', '/api/memory/preview', {
    auth: ANON, body: { sessionId: s2.id, userId: 'u2', query: '笔记' }
  });
  assert.equal(open.status, 200);
  assert.ok(open.payload.appendix.includes('红色笔记'));
});
