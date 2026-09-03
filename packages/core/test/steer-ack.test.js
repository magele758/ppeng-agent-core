import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RawAgentRuntime } from '../dist/runtime.js';
import { decideSteerAdmission, steerAckToHttp } from '../dist/session/steer-ack.js';

class ScriptedAdapter {
  constructor(handler) {
    this.name = 'scripted';
    this.handler = handler;
  }
  async runTurn(input) {
    return this.handler(input);
  }
  async summarizeMessages() {
    return 'summary';
  }
}

function runtimeWithAdapter(adapter) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'raw-agent-repo-'));
  const stateDir = mkdtempSync(join(tmpdir(), 'raw-agent-state-'));
  return new RawAgentRuntime({ repoRoot, stateDir, modelAdapter: adapter });
}

test('decideSteerAdmission: empty / missing / ended / compact / running / idle', () => {
  assert.deepEqual(decideSteerAdmission({ text: '  ' }), { admit: false, reason: 'empty' });
  assert.deepEqual(decideSteerAdmission({ text: 'hi' }), { admit: false, reason: 'no_session' });
  assert.deepEqual(
    decideSteerAdmission({ text: 'hi', session: { status: 'completed', metadata: {} } }),
    { admit: false, reason: 'session_ended' }
  );
  assert.deepEqual(
    decideSteerAdmission({ text: 'hi', session: { status: 'failed', metadata: {} } }),
    { admit: false, reason: 'session_ended' }
  );
  assert.deepEqual(
    decideSteerAdmission({
      text: 'hi',
      session: { status: 'idle', metadata: { compactInFlight: true } }
    }),
    { admit: false, reason: 'compact_in_flight' }
  );
  assert.deepEqual(
    decideSteerAdmission({ text: 'hi', session: { status: 'running', metadata: {} } }),
    { admit: true, status: 'started' }
  );
  assert.deepEqual(
    decideSteerAdmission({ text: 'hi', session: { status: 'idle', metadata: {} } }),
    { admit: true, status: 'started' }
  );
  assert.deepEqual(
    decideSteerAdmission({ text: 'hi', session: { status: 'waiting_approval', metadata: {} } }),
    { admit: true, status: 'started' }
  );
  assert.deepEqual(
    decideSteerAdmission({
      text: 'hi',
      session: { status: 'running', metadata: {} },
      interruptPolicy: 'disabled'
    }),
    { admit: false, reason: 'steer_disabled' }
  );
  assert.deepEqual(
    decideSteerAdmission({
      text: 'hi',
      session: { status: 'running', metadata: {} },
      interruptPolicy: 'queue'
    }),
    { admit: true, status: 'started' }
  );
  assert.deepEqual(
    decideSteerAdmission({
      text: 'hi',
      session: { status: 'running', metadata: {} },
      interruptPolicy: 'steer'
    }),
    { admit: true, status: 'steered' }
  );
});

test('steerAckToHttp maps Codex names onto queued|steered|rejected', () => {
  const item = { id: 's1' };
  assert.deepEqual(steerAckToHttp({ status: 'started', item }), { status: 'queued', item });
  assert.deepEqual(steerAckToHttp({ status: 'steered', item }), { status: 'steered', item });
  assert.deepEqual(steerAckToHttp({ status: 'not_submitted', reason: 'empty' }), {
    status: 'rejected',
    reason: 'empty'
  });
});

test('enqueueSteer / loop.steer: ended session → not_submitted; running → queued; idle → started', async () => {
  const adapter = new ScriptedAdapter(() => ({
    stopReason: 'end',
    assistantParts: [{ type: 'text', text: 'ok' }]
  }));
  const runtime = runtimeWithAdapter(adapter);
  const session = runtime.createChatSession({ title: 'steer-ack', message: 'hello' });

  const started = runtime.enqueueSteer(session.id, 'note while idle');
  assert.equal(started.status, 'started');
  assert.ok(started.item.id);

  runtime.store.updateSession(session.id, { status: 'running' });
  const queued = runtime.enqueueSteer(session.id, 'note while running');
  assert.equal(queued.status, 'started');

  runtime.store.updateSession(session.id, { status: 'completed' });
  const ended = runtime.enqueueSteer(session.id, 'too late');
  assert.equal(ended.status, 'not_submitted');
  assert.equal(ended.reason, 'session_ended');

  const missing = runtime.enqueueSteer('session_nope', 'x');
  assert.equal(missing.status, 'not_submitted');
  assert.equal(missing.reason, 'no_session');

  const empty = runtime.enqueueSteer(session.id, '   ');
  assert.equal(empty.status, 'not_submitted');
  assert.equal(empty.reason, 'empty');

  runtime.store.updateSession(session.id, { status: 'idle' });
  const loop = runtime.createAgentLoop(session.id);
  const ack = await loop.steer('from-loop');
  assert.equal(ack.status, 'started');
});

test('steer disabled: running enqueue is rejected', async () => {
  const adapter = new ScriptedAdapter(() => ({
    stopReason: 'end',
    assistantParts: [{ type: 'text', text: 'ok' }]
  }));
  const runtime = runtimeWithAdapter(adapter);
  const session = runtime.createChatSession({ title: 'steer-off', message: 'hello' });
  runtime.store.setDaemonControl('loop_settings', { steerInterruptPolicy: 'disabled' });
  runtime.store.updateSession(session.id, { status: 'running' });
  const ack = runtime.enqueueSteer(session.id, 'should reject');
  assert.equal(ack.status, 'not_submitted');
  assert.equal(ack.reason, 'steer_disabled');
  assert.equal(runtime.store.listUnclaimedInbox(session.id).length, 0);
});
