import { describe, expect, it } from 'vitest';
import { createMemorySurfaceStore } from './surface-store.js';
import {
  EVENT_LOG_METADATA_KEY,
  beginEventLogRun,
  beginEventLogStep,
  commitEventLogStep,
  createEventLogStepTx,
  endEventLogRun,
  getSessionEventLog,
  persistEventLog,
  retractEventLogUncommitted,
} from './event-log-saga.js';
import { CHECKPOINTS_METADATA_KEY, parseCheckpoints } from './checkpoint.js';
import { createSqliteEventLogStore, type SqliteEventLogHandle } from './event-log-sqlite.js';
import type { KernelStepTx } from '../turn/host.js';

const stepTx = (store: Parameters<typeof createEventLogStepTx>[0]) =>
  createEventLogStepTx(store) as Required<KernelStepTx>;

function newSession() {
  const store = createMemorySurfaceStore();
  const session = store.createSession({ title: 'saga', mode: 'chat', agentId: 'general' });
  store.appendMessage(session.id, 'user', [{ type: 'text', text: 'hi' }]);
  return { store, session };
}

describe('event-log saga primitives', () => {
  it('begin/step/commit/end append the expected event types and idempotent run/start', () => {
    const { store, session } = newSession();
    beginEventLogRun(store, session.id, 'run-1');
    beginEventLogRun(store, session.id, 'run-1');
    beginEventLogStep(store, session.id, { turn: 0, kind: 'model_done' });
    const ckpt = commitEventLogStep(store, session.id, { turn: 0, kind: 'model_done' });
    endEventLogRun(store, session.id, { runId: 'run-1', reason: 'end' });

    const types = getSessionEventLog(store, session.id).getEvents().map((e) => e.type);
    expect(types.filter((t) => t === 'run/start')).toHaveLength(1);
    expect(types).toEqual(
      expect.arrayContaining(['run/start', 'step/start', 'step/end', 'transaction/commit', 'run/end'])
    );
    expect(ckpt?.turn).toBe(0);
    expect(session.metadata?.[EVENT_LOG_METADATA_KEY]).toBeUndefined();
    expect(store.getSession(session.id)?.metadata?.[EVENT_LOG_METADATA_KEY]).toBeDefined();
  });

  it('retractUncommitted shadows events appended after the last committed step', () => {
    const { store, session } = newSession();
    beginEventLogRun(store, session.id, 'run-1');
    commitEventLogStep(store, session.id, { turn: 0, kind: 'model_done' });
    const log = getSessionEventLog(store, session.id);
    log.append('assistant/message', { text: 'poison' }, { surfaceOp: 'append' });
    persistEventLog(store, session.id, log);

    const result = retractEventLogUncommitted(store, session.id, 'model_error');
    expect(result?.shadowedCount).toBeGreaterThan(0);
    const hydrated = getSessionEventLog(store, session.id).hydrate();
    expect(hydrated.some((e) => (e.data as { text?: string } | undefined)?.text === 'poison')).toBe(false);
  });
});

describe('createEventLogStepTx', () => {
  it('writes closed-step checkpoints and rewinds the WAL tail on rollback when the store has a surface', () => {
    const { store, session } = newSession();
    const tx = stepTx(store);
    tx.beginRun({ sessionId: session.id, runId: 'run-a' });
    tx.beginStep({ sessionId: session.id, turn: 0, step: 0, kind: 'model_done' });
    store.appendMessage(session.id, 'assistant', [{ type: 'text', text: 'committed answer' }]);
    tx.commitStep({ sessionId: session.id, turn: 0, step: 0, kind: 'model_done' });

    const ckpts = parseCheckpoints(store.getSession(session.id)?.metadata);
    expect(ckpts).toHaveLength(1);
    const committedSeq = ckpts[0]!.seq;
    expect(committedSeq).toBe(store.listSurfaceNodes(session.id).at(-1)!.seq);

    // Uncommitted tail: an open tool wave that the model never closed.
    store.appendMessage(session.id, 'assistant', [
      { type: 'tool_call', toolCallId: 'tc1', name: 'bash', input: { command: 'ls' } },
    ]);
    expect(store.foldMessages(session.id)).toHaveLength(3);

    tx.rollbackUncommitted('model_error');
    const folded = store.foldMessages(session.id);
    expect(folded).toHaveLength(2);
    expect(folded.at(-1)!.parts[0]).toMatchObject({ type: 'text', text: 'committed answer' });
    // Checkpoint list is untouched by the rewind.
    expect(parseCheckpoints(store.getSession(session.id)?.metadata)).toHaveLength(1);
  });

  it('does not checkpoint while a tool wave is open', () => {
    const { store, session } = newSession();
    const tx = stepTx(store);
    tx.beginRun({ sessionId: session.id, runId: 'run-a' });
    store.appendMessage(session.id, 'assistant', [
      { type: 'tool_call', toolCallId: 'tc1', name: 'bash', input: {} },
    ]);
    tx.commitStep({ sessionId: session.id, turn: 0, step: 0, kind: 'model_done' });
    expect(store.getSession(session.id)?.metadata?.[CHECKPOINTS_METADATA_KEY]).toBeUndefined();
  });

  it('stays fail-soft on a minimal metadata-only store', () => {
    const sessions = new Map<string, { id: string; metadata?: Record<string, unknown> }>();
    sessions.set('s1', { id: 's1', metadata: {} });
    const tx = stepTx({
      getSession: (id) => sessions.get(id) as never,
      updateSession: (id, patch) => {
        const cur = sessions.get(id)!;
        const next = { ...cur, ...(patch as object) };
        sessions.set(id, next);
        return next as never;
      },
    });
    tx.beginRun({ sessionId: 's1', runId: 'r1' });
    tx.commitStep({ sessionId: 's1', turn: 0, step: 0, kind: 'model_done' });
    expect(() => tx.rollbackUncommitted('model_error')).not.toThrow();
    expect(sessions.get('s1')?.metadata?.[EVENT_LOG_METADATA_KEY]).toBeDefined();
    expect(sessions.get('s1')?.metadata?.[CHECKPOINTS_METADATA_KEY]).toBeUndefined();
  });
});

describe('createSqliteEventLogStore', () => {
  function fakeHandle(): SqliteEventLogHandle & { rows: Map<string, string> } {
    const rows = new Map<string, string>();
    return {
      rows,
      filename: ':memory:',
      exec: () => undefined,
      save: (id, payload) => {
        rows.set(id, payload);
      },
      load: (id) => rows.get(id),
      remove: (id) => {
        rows.delete(id);
      },
      close: () => undefined,
    };
  }

  it('mirrors metadata.eventLog into sqlite and reads it back first', () => {
    const { store, session } = newSession();
    const handle = fakeHandle();
    const wrapped = createSqliteEventLogStore(store, handle);

    beginEventLogRun(wrapped, session.id, 'run-1');
    commitEventLogStep(wrapped, session.id, { turn: 0, kind: 'model_done' });
    expect(handle.rows.has(session.id)).toBe(true);

    // Simulate an in-memory store that lost its metadata (restart) — sqlite wins.
    const bare = store.getSession(session.id)!;
    store.updateSession(session.id, { metadata: { ...bare.metadata, [EVENT_LOG_METADATA_KEY]: undefined } });
    expect(store.getSession(session.id)?.metadata?.[EVENT_LOG_METADATA_KEY]).toBeUndefined();
    const types = getSessionEventLog(wrapped, session.id).getEvents().map((e) => e.type);
    expect(types).toContain('run/start');
    expect(types).toContain('transaction/commit');
  });

  it('keeps the inner surface methods reachable so the stepTx still checkpoints', () => {
    const { store, session } = newSession();
    const wrapped = createSqliteEventLogStore(store, fakeHandle());
    const tx = stepTx(wrapped);
    tx.beginRun({ sessionId: session.id, runId: 'run-a' });
    store.appendMessage(session.id, 'assistant', [{ type: 'text', text: 'ok' }]);
    tx.commitStep({ sessionId: session.id, turn: 0, step: 0, kind: 'model_done' });
    expect(parseCheckpoints(store.getSession(session.id)?.metadata)).toHaveLength(1);
    expect(wrapped.foldMessages(session.id)).toHaveLength(2);
  });
});
