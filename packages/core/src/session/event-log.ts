/**
 * Independent append-only EventLog (Saga source of truth).
 *
 * Parallel to WAL+fold (Chat hydrate). Product unit = closed step (`step/end`).
 * Failure retracts the uncommitted tail; retracted surface events stay out of
 * EventLog hydrate. No OA / edition / host-native / Catalog types.
 */

import { createId, nowIso } from '../id.js';

export type EventLogType =
  | 'run/start'
  | 'run/end'
  | 'step/start'
  | 'step/end'
  | 'user/message'
  | 'assistant/message'
  | 'tool/call'
  | 'tool/result'
  | 'saga/retract'
  | 'transaction/commit'
  | 'transaction/rollback';

export type EventLogSurfaceOp = 'append' | { op: 'replace'; start: number; end: number };

export interface EventLogEvent<T extends EventLogType = EventLogType> {
  seq: number;
  type: T;
  data: unknown;
  surfaceOp?: EventLogSurfaceOp;
  sourceEventSeqs?: number[];
  timestamp: number;
}

export interface EventLogCheckpoint {
  id: string;
  sessionId: string;
  seq: number;
  turn: number;
  label: string;
  createdAt: string;
}

export type EventLogCheckpointRejection =
  | { kind: 'empty-log' }
  | { kind: 'not-closed-boundary'; lastEventType?: string };

export type EventLogCheckpointResult =
  | { ok: true; checkpoint: EventLogCheckpoint }
  | { ok: false; reason: EventLogCheckpointRejection };

export interface EventLogRetractResult {
  retracted: boolean;
  anchorSeq: number;
  shadowedCount: number;
  reason: string;
}

export interface PersistedEventLog {
  events: EventLogEvent[];
  checkpoints: EventLogCheckpoint[];
}

const SURFACE_TYPES: ReadonlySet<EventLogType> = new Set([
  'user/message',
  'assistant/message',
  'tool/call',
  'tool/result'
]);

export function isSurfaceEventType(type: string): type is EventLogType {
  return (
    type === 'user/message' ||
    type === 'assistant/message' ||
    type === 'tool/call' ||
    type === 'tool/result'
  );
}

export function isClosedBoundaryType(type: string): boolean {
  return type === 'step/end' || type === 'run/end';
}

export function isEventLogType(type: unknown): type is EventLogType {
  switch (type) {
    case 'run/start':
    case 'run/end':
    case 'step/start':
    case 'step/end':
    case 'user/message':
    case 'assistant/message':
    case 'tool/call':
    case 'tool/result':
    case 'saga/retract':
    case 'transaction/commit':
    case 'transaction/rollback':
      return true;
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function isTombstone(event: EventLogEvent): boolean {
  return isRecord(event.data) && event.data.tombstone === true;
}

export function foldEventLogSurface(events: readonly EventLogEvent[]): EventLogEvent[] {
  const nodes: EventLogEvent[] = [];
  for (const event of events) {
    if (!isSurfaceEventType(event.type)) continue;
    const op = event.surfaceOp ?? 'append';
    if (op === 'append') {
      nodes.push(event);
      continue;
    }
    let startIdx = -1;
    let endIdx = -1;
    for (let i = 0; i < nodes.length; i++) {
      const seq = nodes[i]!.seq;
      if (seq >= op.start && seq <= op.end) {
        if (startIdx === -1) startIdx = i;
        endIdx = i;
      }
    }
    if (startIdx === -1) continue;
    if (isTombstone(event)) {
      nodes.splice(startIdx, endIdx - startIdx + 1);
    } else {
      nodes.splice(startIdx, endIdx - startIdx + 1, event);
    }
  }
  return nodes;
}

/** EventLog hydrate — not Chat/WAL fold. Retracted surface events are gone. */
export function hydrateEventLog(events: readonly EventLogEvent[]): EventLogEvent[] {
  return foldEventLogSurface(events);
}

export function lastClosedStepSeq(events: readonly EventLogEvent[]): number | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]!.type === 'step/end') return events[i]!.seq;
  }
  return undefined;
}

export function lastRunStartSeq(events: readonly EventLogEvent[]): number | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]!.type === 'run/start') return events[i]!.seq;
  }
  return undefined;
}

/** Uncommitted-tail anchor: last `step/end`, else `run/start`. */
export function uncommittedRewindAnchorSeq(events: readonly EventLogEvent[]): number {
  const step = lastClosedStepSeq(events);
  if (step != null) return step;
  return lastRunStartSeq(events) ?? -1;
}

export class SessionEventLog {
  private events: EventLogEvent[] = [];
  private nextSeq = 0;
  private checkpoints: EventLogCheckpoint[] = [];

  constructor(
    readonly sessionId: string,
    initial?: PersistedEventLog
  ) {
    if (initial?.events?.length) {
      this.events = initial.events.map((e) => ({ ...e }));
      this.nextSeq = Math.max(...this.events.map((e) => e.seq)) + 1;
    }
    if (initial?.checkpoints?.length) {
      this.checkpoints = initial.checkpoints.map((c) => ({ ...c }));
    }
  }

  append(
    type: EventLogType,
    data: unknown,
    opts?: { surfaceOp?: EventLogSurfaceOp; sourceEventSeqs?: number[] }
  ): EventLogEvent {
    const event: EventLogEvent = {
      seq: this.nextSeq++,
      type,
      data,
      timestamp: Date.now(),
      ...opts
    };
    this.events.push(event);
    return event;
  }

  getEvents(upToSeq?: number): readonly EventLogEvent[] {
    if (upToSeq === undefined) return this.events;
    return this.events.filter((e) => e.seq <= upToSeq);
  }

  head(): number {
    return this.nextSeq - 1;
  }

  hydrate(upToSeq?: number): EventLogEvent[] {
    return hydrateEventLog(this.getEvents(upToSeq));
  }

  /**
   * Hide currently visible surface nodes in [start, end] via a tombstone.
   * Returns the tombstone seq, or -1 when the range is already empty.
   */
  appendReplacement(start: number, end: number, reason: string): number {
    const visible = foldEventLogSurface(this.events);
    const shadowed: number[] = [];
    for (const node of visible) {
      if (node.seq >= start && node.seq <= end) shadowed.push(node.seq);
    }
    if (shadowed.length === 0) return -1;
    const appended = this.append(
      'assistant/message',
      { tombstone: true, reason },
      {
        surfaceOp: { op: 'replace', start: shadowed[0]!, end: shadowed[shadowed.length - 1]! },
        sourceEventSeqs: shadowed
      }
    );
    return appended.seq;
  }

  /** Retract surface after the last closed step (or run/start). */
  retractUncommitted(reason: string): EventLogRetractResult {
    const anchor = uncommittedRewindAnchorSeq(this.events);
    const currentHead = this.head();
    if (currentHead <= anchor) {
      this.append('saga/retract', { reason, anchorSeq: anchor, shadowedCount: 0 });
      this.append('transaction/rollback', { reason, anchorSeq: anchor });
      return { retracted: false, anchorSeq: anchor, shadowedCount: 0, reason };
    }
    const start = anchor + 1;
    this.appendReplacement(start, currentHead, 'saga-retract');
    const shadowedCount = currentHead - anchor;
    this.append('saga/retract', { reason, anchorSeq: anchor, fromSeq: start, toSeq: currentHead, shadowedCount });
    this.append('transaction/rollback', { reason, anchorSeq: anchor });
    return { retracted: true, anchorSeq: anchor, shadowedCount, reason };
  }

  saveClosedCheckpoint(input: { turn?: number; label?: string }): EventLogCheckpointResult {
    const last = this.events[this.events.length - 1];
    if (!last) return { ok: false, reason: { kind: 'empty-log' } };
    if (!isClosedBoundaryType(last.type)) {
      return { ok: false, reason: { kind: 'not-closed-boundary', lastEventType: last.type } };
    }
    const existing = this.checkpoints[this.checkpoints.length - 1];
    if (existing && existing.seq === last.seq) {
      return { ok: true, checkpoint: existing };
    }
    const checkpoint: EventLogCheckpoint = {
      id: createId('elogckpt'),
      sessionId: this.sessionId,
      seq: last.seq,
      turn: input.turn ?? this.checkpoints.length,
      label: input.label ?? last.type,
      createdAt: nowIso()
    };
    this.checkpoints.push(checkpoint);
    return { ok: true, checkpoint };
  }

  listCheckpoints(): readonly EventLogCheckpoint[] {
    return this.checkpoints;
  }

  latestCheckpoint(): EventLogCheckpoint | undefined {
    return this.checkpoints[this.checkpoints.length - 1];
  }

  toJSON(): PersistedEventLog {
    return {
      events: this.events.map((e) => ({ ...e })),
      checkpoints: this.checkpoints.map((c) => ({ ...c }))
    };
  }

  static parsePersisted(raw: unknown): PersistedEventLog | undefined {
    if (!isRecord(raw)) return undefined;
    const eventsIn = raw.events;
    if (!Array.isArray(eventsIn)) return undefined;
    const events: EventLogEvent[] = [];
    for (const item of eventsIn) {
      if (!isRecord(item) || !isEventLogType(item.type)) continue;
      if (typeof item.seq !== 'number' || !Number.isFinite(item.seq)) continue;
      events.push({
        seq: item.seq,
        type: item.type,
        data: item.data,
        timestamp: typeof item.timestamp === 'number' ? item.timestamp : 0,
        ...(item.surfaceOp !== undefined
          ? { surfaceOp: item.surfaceOp as EventLogSurfaceOp }
          : {}),
        ...(Array.isArray(item.sourceEventSeqs)
          ? { sourceEventSeqs: item.sourceEventSeqs.filter((n): n is number => typeof n === 'number') }
          : {})
      });
    }
    const checkpoints: EventLogCheckpoint[] = [];
    if (Array.isArray(raw.checkpoints)) {
      for (const item of raw.checkpoints) {
        if (!isRecord(item) || typeof item.id !== 'string' || typeof item.sessionId !== 'string') {
          continue;
        }
        if (typeof item.seq !== 'number') continue;
        checkpoints.push({
          id: item.id,
          sessionId: item.sessionId,
          seq: item.seq,
          turn: typeof item.turn === 'number' ? item.turn : -1,
          label: typeof item.label === 'string' ? item.label : '',
          createdAt: typeof item.createdAt === 'string' ? item.createdAt : ''
        });
      }
    }
    return { events, checkpoints };
  }
}

/** Nested / Teams / sub-agent log — never written into a parent session. */
export function createEphemeralEventLog(ownerId: string): SessionEventLog {
  return new SessionEventLog(`ephemeral:${ownerId}`);
}
