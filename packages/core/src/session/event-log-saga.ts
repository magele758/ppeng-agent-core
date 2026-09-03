/**
 * Per-run Saga over an independent EventLog.
 *
 * Nested sub-runs use {@link createEphemeralEventLog} (or the child session's
 * own log). Parent EventLog never receives child chat as ordinary messages.
 */

import type { SessionRecord } from '../types.js';
import {
  createEphemeralEventLog,
  SessionEventLog,
  type EventLogCheckpoint,
  type EventLogRetractResult
} from './event-log.js';
import { isEventLogEnabled, type EventLogSettingsStore } from './event-log-settings.js';

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
    log.append('transaction/commit', { turn: info.turn, kind: info.kind ?? info.label });
    const saved = log.saveClosedCheckpoint({ turn: info.turn, label: info.label ?? 'step-end' });
    if (saved.ok) checkpoint = saved.checkpoint;
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

export { createEphemeralEventLog };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}
