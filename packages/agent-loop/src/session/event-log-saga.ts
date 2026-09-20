/**
 * Per-run Saga over an independent EventLog.
 *
 * Nested sub-runs use {@link createEphemeralEventLog} (or the child session's
 * own log). Parent EventLog never receives child chat as ordinary messages.
 */

import type { SessionRecord } from '../types.js';
import type { KernelStepTx } from '../turn/host.js';
import {
  createEphemeralEventLog,
  SessionEventLog,
  type EventLogCheckpoint,
  type EventLogRetractResult
} from './event-log.js';
import { isEventLogEnabled, type EventLogSettingsStore } from './event-log-settings.js';
import { isCheckpointStore, rewindUncommittedTail, saveStepCheckpoint } from './checkpoint.js';

export const EVENT_LOG_METADATA_KEY = 'eventLog';

export interface EventLogPersistStore {
  getSession(id: string): SessionRecord | undefined;
  updateSession(
    id: string,
    patch: Partial<Omit<SessionRecord, 'id' | 'createdAt'>>
  ): SessionRecord;
  getDaemonControl?(key: string): unknown;
}

export interface EventLogStepInfo {
  turn: number;
  label?: string;
  kind?: string;
}

export function loadEventLog(session: SessionRecord | undefined): SessionEventLog {
  const id = session?.id ?? 'unknown';
  const persisted = SessionEventLog.parsePersisted(session?.metadata?.[EVENT_LOG_METADATA_KEY]);
  return persisted ? new SessionEventLog(id, persisted) : new SessionEventLog(id);
}

export function persistEventLog(store: EventLogPersistStore, sessionId: string, log: SessionEventLog): void {
  const current = store.getSession(sessionId);
  if (!current) return;
  store.updateSession(sessionId, {
    metadata: {
      ...(current.metadata ?? {}),
      [EVENT_LOG_METADATA_KEY]: log.toJSON()
    }
  });
}

function withLog(
  store: EventLogPersistStore,
  sessionId: string,
  fn: (log: SessionEventLog) => void
): SessionEventLog | undefined {
  if (!isEventLogEnabled(store as EventLogSettingsStore)) return undefined;
  const session = store.getSession(sessionId);
  if (!session) return undefined;
  const log = loadEventLog(session);
  fn(log);
  persistEventLog(store, sessionId, log);
  return log;
}

/** Start a run saga. Resume with the same runId is a no-op. */
export function beginEventLogRun(
  store: EventLogPersistStore,
  sessionId: string,
  runId: string
): void {
  withLog(store, sessionId, (log) => {
    const events = log.getEvents();
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]!;
      if (e.type === 'run/end') break;
      if (e.type === 'run/start' && isRecord(e.data) && e.data.runId === runId) {
        return;
      }
    }
    log.append('run/start', { runId, sessionId });
  });
}

export function beginEventLogStep(
  store: EventLogPersistStore,
  sessionId: string,
  info: EventLogStepInfo
): void {
  withLog(store, sessionId, (log) => {
    log.append('step/start', { turn: info.turn, kind: info.kind ?? info.label });
  });
}

export function commitEventLogStep(
  store: EventLogPersistStore,
  sessionId: string,
  info: EventLogStepInfo
): EventLogCheckpoint | undefined {
  let checkpoint: EventLogCheckpoint | undefined;
  withLog(store, sessionId, (log) => {
    log.append('step/end', { turn: info.turn, kind: info.kind ?? info.label });
    // Checkpoint must anchor on the closed boundary (`step/end`), i.e. before
    // the `transaction/commit` marker, otherwise saveClosedCheckpoint rejects it.
    const saved = log.saveClosedCheckpoint({ turn: info.turn, label: info.label ?? 'step-end' });
    if (saved.ok) checkpoint = saved.checkpoint;
    log.append('transaction/commit', { turn: info.turn, kind: info.kind ?? info.label });
  });
  return checkpoint;
}

export function retractEventLogUncommitted(
  store: EventLogPersistStore,
  sessionId: string,
  reason: string
): EventLogRetractResult | undefined {
  let result: EventLogRetractResult | undefined;
  withLog(store, sessionId, (log) => {
    result = log.retractUncommitted(reason);
  });
  return result;
}

export function endEventLogRun(
  store: EventLogPersistStore,
  sessionId: string,
  input: { runId: string; reason: string }
): void {
  withLog(store, sessionId, (log) => {
    log.append('run/end', { runId: input.runId, reason: input.reason });
  });
}

export function getSessionEventLog(store: EventLogPersistStore, sessionId: string): SessionEventLog {
  return loadEventLog(store.getSession(sessionId));
}

/**
 * Kernel stepTx backed by EventLog (full+). Fail-soft: a disabled or
 * table-less store is a no-op. When `store` also
 * exposes the surface (`foldMessages` / `listSurfaceNodes` / `hideRange`),
 * every committed step additionally records a closed-step checkpoint and
 * `rollbackUncommitted` hides the WAL tail after the last checkpoint, so
 * `decideRewindTail` / auto-fork have something to anchor on.
 */
export function createEventLogStepTx(store: EventLogPersistStore): KernelStepTx {
  let lastSessionId: string | undefined;
  const checkpoints = isCheckpointStore(store) ? store : undefined;
  return {
    beginRun(info) {
      lastSessionId = info.sessionId;
      try {
        beginEventLogRun(store, info.sessionId, info.runId);
      } catch {
        /* fail-soft */
      }
    },
    endRun(info) {
      lastSessionId = info.sessionId ?? lastSessionId;
      try {
        endEventLogRun(store, info.sessionId, { runId: info.runId, reason: info.reason ?? 'end' });
      } catch {
        /* fail-soft */
      }
    },
    beginStep(info) {
      lastSessionId = info.sessionId ?? lastSessionId;
      const sid = info.sessionId ?? lastSessionId;
      if (!sid) return;
      try {
        beginEventLogStep(store, sid, { turn: info.turn, kind: info.kind });
      } catch {
        /* fail-soft */
      }
    },
    commitStep(info) {
      const sid = info.sessionId ?? lastSessionId;
      if (!sid) return;
      lastSessionId = sid;
      if (checkpoints) {
        try {
          saveStepCheckpoint(checkpoints, sid, { turn: info.turn, label: info.kind });
        } catch {
          /* fail-soft */
        }
      }
      try {
        commitEventLogStep(store, sid, { turn: info.turn, label: info.kind });
      } catch {
        /* fail-soft */
      }
    },
    rollbackUncommitted(reason) {
      if (!lastSessionId) return;
      if (checkpoints) {
        try {
          rewindUncommittedTail(checkpoints, lastSessionId, { reason });
        } catch {
          /* fail-soft */
        }
      }
      try {
        retractEventLogUncommitted(store, lastSessionId, reason);
      } catch {
        /* fail-soft */
      }
    },
  };
}

export { createEphemeralEventLog };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}
