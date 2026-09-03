import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemorySurfaceStore } from '../dist/session/index.js';
import {
  SessionEventLog,
  createEphemeralEventLog,
  hydrateEventLog
} from '../dist/session/event-log.js';
import {
  beginEventLogRun,
  commitEventLogStep,
  getSessionEventLog,
  persistEventLog,
  retractEventLogUncommitted
} from '../dist/session/event-log-saga.js';
import {
  EVENT_LOG_SETTINGS_KEY,
  isEventLogEnabled,
  readEventLogSettings,
  writeEventLogSettings
} from '../dist/session/event-log-settings.js';
import { buildTrajectorySnapshot } from '../dist/session/trajectory.js';

test('append-only EventLog assigns monotonic seq', () => {
  const log = new SessionEventLog('s1');
  const a = log.append('user/message', { text: 'hi' }, { surfaceOp: 'append' });
  const b = log.append('assistant/message', { text: 'yo' }, { surfaceOp: 'append' });
  assert.equal(a.seq, 0);
  assert.equal(b.seq, 1);
  assert.equal(log.getEvents().length, 2);
  assert.equal(log.head(), 1);
});

test('closed checkpoint only on step/end; mid-step rejected', () => {
  const log = new SessionEventLog('s-ckpt');
  log.append('run/start', { runId: 'r1' });
  log.append('user/message', { text: 'q' }, { surfaceOp: 'append' });
  const open = log.saveClosedCheckpoint({ turn: 0, label: 'mid' });
  assert.equal(open.ok, false);
  assert.equal(open.reason.kind, 'not-closed-boundary');

  log.append('step/end', { turn: 0, kind: 'step-end' });
  const saved = log.saveClosedCheckpoint({ turn: 0, label: 'step-end' });
  assert.equal(saved.ok, true);
  assert.equal(saved.checkpoint.seq, log.head());
  const again = log.saveClosedCheckpoint({ turn: 0, label: 'step-end' });
  assert.equal(again.ok, true);
  assert.equal(again.checkpoint.id, saved.checkpoint.id);
});

test('fail retract hides uncommitted tail from EventLog hydrate (not Chat WAL)', () => {
  const log = new SessionEventLog('s-retract');
  log.append('run/start', { runId: 'r1' });
  log.append('user/message', { text: 'committed-user' }, { surfaceOp: 'append' });
  log.append('assistant/message', { text: 'committed-asst' }, { surfaceOp: 'append' });
  log.append('step/end', { turn: 0 });
  log.saveClosedCheckpoint({ turn: 0, label: 'step-end' });

  log.append('assistant/message', { text: 'failed-tail' }, { surfaceOp: 'append' });
  log.append('tool/call', { name: 'bash', callId: 'c1' }, { surfaceOp: 'append' });
  const retract = log.retractUncommitted('tool_loop');
  assert.equal(retract.retracted, true);
  assert.ok(retract.shadowedCount >= 2);

  const hydrated = hydrateEventLog(log.getEvents());
  const texts = hydrated.flatMap((e) => {
    const d = e.data && typeof e.data === 'object' ? e.data : {};
    return typeof d.text === 'string' ? [d.text] : [];
  });
  assert.ok(texts.includes('committed-user'));
  assert.ok(texts.includes('committed-asst'));
  assert.ok(!texts.includes('failed-tail'));
  assert.ok(!hydrated.some((e) => e.type === 'tool/call'));
  assert.ok(log.getEvents().some((e) => e.type === 'saga/retract'));
});

test('trajectory excludes chat bubbles (user/assistant messages)', () => {
  const log = new SessionEventLog('s-traj');
  log.append('run/start', { runId: 'r1' });
  log.append('user/message', { text: 'hello-bubble' }, { surfaceOp: 'append' });
  log.append('assistant/message', { text: 'reply-bubble' }, { surfaceOp: 'append' });
  log.append('tool/call', { name: 'read', callId: 't1' }, { surfaceOp: 'append' });
  log.append('step/end', { turn: 0 });
  log.append('transaction/commit', { turn: 0 });

  const snap = buildTrajectorySnapshot(log.getEvents());
  const kinds = snap.turns.flatMap((t) => t.records.map((r) => r.kind));
  const eventTypes = snap.turns.flatMap((t) => t.records.map((r) => r.eventType));
  assert.ok(kinds.includes('run'));
  assert.ok(kinds.includes('step'));
  assert.ok(kinds.includes('tool'));
  assert.ok(!kinds.includes('user'));
  assert.ok(!kinds.includes('assistant'));
  assert.ok(!eventTypes.includes('user/message'));
  assert.ok(!eventTypes.includes('assistant/message'));
  const dumped = JSON.stringify(snap);
  assert.ok(!dumped.includes('hello-bubble'));
  assert.ok(!dumped.includes('reply-bubble'));
});

test('saga persist + fail retract does not enter EventLog hydrate', () => {
  const store = createMemorySurfaceStore();
  const session = store.createSession({ title: 'saga', mode: 'chat', agentId: 'general' });
  store.appendMessage(session.id, 'user', [{ type: 'text', text: 'chat-bubble' }]);
  beginEventLogRun(store, session.id, 'run-a');
  commitEventLogStep(store, session.id, { turn: 0, label: 'step-end' });
  const log = getSessionEventLog(store, session.id);
  log.append('assistant/message', { text: 'poison' }, { surfaceOp: 'append' });
  persistEventLog(store, session.id, log);

  const retract = retractEventLogUncommitted(store, session.id, 'model_error');
  assert.equal(retract?.retracted, true);
  const hydrated = getSessionEventLog(store, session.id).hydrate();
  assert.ok(!hydrated.some((e) => e.data && e.data.text === 'poison'));
  const chat = store.foldMessages(session.id);
  assert.ok(chat.some((m) => m.parts.some((p) => p.type === 'text' && p.text === 'chat-bubble')));
});

test('ephemeral nested log never writes into parent EventLog', () => {
  const parent = new SessionEventLog('parent');
  parent.append('run/start', { runId: 'parent-run' });
  const child = createEphemeralEventLog('parent');
  child.append('user/message', { text: 'child-chat' }, { surfaceOp: 'append' });
  child.append('step/end', { turn: 0 });
  assert.equal(parent.getEvents().length, 1);
  assert.ok(!parent.hydrate().some((e) => e.data && e.data.text === 'child-chat'));
  assert.ok(child.sessionId.startsWith('ephemeral:'));
});

test('event-log settings persist in daemon_control KV (no env switch)', () => {
  const kv = new Map();
  const store = {
    getDaemonControl(key) {
      return kv.get(key);
    },
    setDaemonControl(key, value) {
      kv.set(key, value);
    }
  };
  assert.equal(isEventLogEnabled(store), true);
  const written = writeEventLogSettings(store, { enabled: false });
  assert.equal(written.enabled, false);
  assert.equal(readEventLogSettings(store).enabled, false);
  assert.equal(kv.get(EVENT_LOG_SETTINGS_KEY).enabled, false);
});
