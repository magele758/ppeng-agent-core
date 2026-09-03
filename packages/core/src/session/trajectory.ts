/**
 * EventLog second projection (debug / eval). Never used for Chat hydrate.
 * No user/assistant chat-bubble records.
 */

import {
  foldEventLogSurface,
  isEventLogType,
  type EventLogEvent,
  type EventLogType
} from './event-log.js';

export type TrajectoryRecordKind = 'run' | 'step' | 'tool' | 'saga';

export type TrajectoryTurnStatus = 'committed' | 'rolled_back' | 'in_progress';

export interface TrajectoryRecord {
  kind: TrajectoryRecordKind;
  seq: number;
  eventType: EventLogType;
  surfaceHidden: boolean;
  data: unknown;
  timestamp?: number;
}

export interface TrajectoryTurn {
  turn: number | null;
  startSeq: number | null;
  endSeq: number | null;
  open: boolean;
  status?: TrajectoryTurnStatus;
  endReason?: string;
  rollbackReason?: string;
  records: TrajectoryRecord[];
}

export interface TrajectorySnapshot {
  turns: TrajectoryTurn[];
}

export interface BuildTrajectorySnapshotOptions {
  fromSeq?: number;
  limit?: number;
}

export interface TrajectoryQuery {
  fromSeq?: number;
  limit?: number;
}

export type ParseTrajectoryQueryResult =
  | { ok: true; query: TrajectoryQuery }
  | { ok: false; error: string };

interface MutableTurn {
  turn: number | null;
  startSeq: number | null;
  endSeq: number | null;
  open: boolean;
  status?: TrajectoryTurnStatus;
  endReason?: string;
  rollbackReason?: string;
  records: TrajectoryRecord[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function isTombstone(event: EventLogEvent): boolean {
  return isRecord(event.data) && event.data.tombstone === true;
}

function readTurn(data: unknown): number | null {
  if (!isRecord(data)) return null;
  const turn = data.turn;
  return typeof turn === 'number' && Number.isFinite(turn) ? turn : null;
}

function readStringField(data: unknown, key: string): string | undefined {
  if (!isRecord(data)) return undefined;
  const value = data[key];
  return typeof value === 'string' ? value : undefined;
}

function windowEvents(
  events: readonly EventLogEvent[],
  fromSeq?: number,
  limit?: number
): EventLogEvent[] {
  let start = 0;
  if (fromSeq !== undefined) {
    start = events.findIndex((event) => event.seq >= fromSeq);
    if (start < 0) return [];
  }
  if (limit === undefined) return events.slice(start);
  if (limit <= 0) return [];
  return events.slice(start, start + limit);
}

function ledgerKind(type: EventLogType): TrajectoryRecordKind | null {
  switch (type) {
    case 'run/start':
    case 'run/end':
      return 'run';
    case 'step/start':
    case 'step/end':
      return 'step';
    case 'tool/call':
    case 'tool/result':
      return 'tool';
    case 'saga/retract':
    case 'transaction/commit':
    case 'transaction/rollback':
      return 'saga';
    case 'user/message':
    case 'assistant/message':
      return null;
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

function assignTurn(
  turns: MutableTurn[],
  current: MutableTurn | null,
  eventTurn: number | null
): MutableTurn {
  if (current?.open) return current;
  if (eventTurn !== null) {
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i]!.turn === eventTurn) return turns[i]!;
    }
  }
  if (current) return current;
  const implicit: MutableTurn = {
    turn: eventTurn,
    startSeq: null,
    endSeq: null,
    open: true,
    records: []
  };
  turns.push(implicit);
  return implicit;
}

function findTurnToEnd(
  turns: MutableTurn[],
  current: MutableTurn | null,
  eventTurn: number | null
): MutableTurn | null {
  if (eventTurn !== null) {
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i]!.turn === eventTurn && turns[i]!.open) return turns[i]!;
    }
  }
  if (current?.open) return current;
  return null;
}

export function buildTrajectorySnapshot(
  events: readonly EventLogEvent[],
  opts: BuildTrajectorySnapshotOptions = {}
): TrajectorySnapshot {
  const ordered = events.slice().sort((a, b) => a.seq - b.seq);
  const visibleSeqs = new Set(foldEventLogSurface(ordered).map((node) => node.seq));
  const windowed = windowEvents(ordered, opts.fromSeq, opts.limit);
  const turns: MutableTurn[] = [];
  let current: MutableTurn | null = null;

  for (const event of windowed) {
    if (!isEventLogType(event.type)) continue;

    if (event.type === 'run/start') {
      current = {
        turn: readTurn(event.data),
        startSeq: event.seq,
        endSeq: null,
        open: true,
        records: []
      };
      turns.push(current);
      current.records.push({
        kind: 'run',
        seq: event.seq,
        eventType: event.type,
        surfaceHidden: false,
        data: event.data,
        timestamp: event.timestamp
      });
      continue;
    }

    if (event.type === 'transaction/commit') {
      const target = assignTurn(turns, current, readTurn(event.data));
      current = target;
      target.status = 'committed';
      continue;
    }

    if (event.type === 'saga/retract' || event.type === 'transaction/rollback') {
      const target = assignTurn(turns, current, readTurn(event.data));
      current = target;
      target.status = 'rolled_back';
      const rollbackReason = readStringField(event.data, 'reason');
      if (rollbackReason !== undefined) target.rollbackReason = rollbackReason;
      target.records.push({
        kind: 'saga',
        seq: event.seq,
        eventType: event.type,
        surfaceHidden: false,
        data: event.data,
        timestamp: event.timestamp
      });
      continue;
    }

    if (event.type === 'run/end') {
      const ended = findTurnToEnd(turns, current, readTurn(event.data));
      if (ended) {
        ended.endSeq = event.seq;
        ended.open = false;
        current = ended;
        const endReason = readStringField(event.data, 'reason');
        if (endReason !== undefined) ended.endReason = endReason;
        ended.records.push({
          kind: 'run',
          seq: event.seq,
          eventType: event.type,
          surfaceHidden: false,
          data: event.data,
          timestamp: event.timestamp
        });
      }
      continue;
    }

    const kind = ledgerKind(event.type);
    if (kind === null) continue;
    if (isTombstone(event)) continue;

    const target = assignTurn(turns, current, readTurn(event.data));
    current = target;
    const surfaceEligible = event.type === 'tool/call' || event.type === 'tool/result';
    target.records.push({
      kind,
      seq: event.seq,
      eventType: event.type,
      surfaceHidden: surfaceEligible && !visibleSeqs.has(event.seq),
      data: event.data,
      timestamp: event.timestamp
    });
  }

  for (const turn of turns) {
    if (turn.open && !turn.status) turn.status = 'in_progress';
  }

  return { turns };
}

export function parseOptionalSafeInt(
  raw: unknown,
  name: string
): { ok: true; value?: number } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true };
  const n = typeof raw === 'number' ? raw : Number(String(raw));
  if (!Number.isFinite(n) || !Number.isSafeInteger(n)) {
    return { ok: false, error: `${name} must be a safe integer` };
  }
  return { ok: true, value: n };
}

export function parseTrajectoryQuery(input: {
  fromSeq?: unknown;
  limit?: unknown;
}): ParseTrajectoryQueryResult {
  const from = parseOptionalSafeInt(input.fromSeq, 'fromSeq');
  if (!from.ok) return from;
  const limit = parseOptionalSafeInt(input.limit, 'limit');
  if (!limit.ok) return limit;
  const query: TrajectoryQuery = {};
  if (from.value !== undefined) query.fromSeq = from.value;
  if (limit.value !== undefined) query.limit = limit.value;
  return { ok: true, query };
}
