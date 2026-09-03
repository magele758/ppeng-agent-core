/**
 * Closed-step checkpoints on the existing WAL+fold surface.
 *
 * A checkpoint is only legal when the fold has no open tool wave
 * (aligned with node EventLog `turn/end` / `step/end` boundaries).
 * Rewind hides the uncommitted tail — WAL rows stay.
 */

import { createId, nowIso } from '../id.js';
import { isToolWaveOpen } from './surface-invariants.js';
import type { SessionMessage, SessionRecord } from '../types.js';
import type { SurfaceNode } from './surface-invariants.js';

export const CHECKPOINTS_METADATA_KEY = 'stepCheckpoints';

export interface StepCheckpoint {
  id: string;
  sessionId: string;
  seq: number;
  turn: number;
  label: string;
  createdAt: string;
}

export type CheckpointRejection =
  | { kind: 'empty-log' }
  | { kind: 'not-closed-boundary' };

export type CheckpointResult =
  | { ok: true; checkpoint: StepCheckpoint }
  | { ok: false; reason: CheckpointRejection };

export interface CheckpointStore {
  getSession(id: string): SessionRecord | undefined;
  updateSession(
    id: string,
    patch: Partial<Omit<SessionRecord, 'id' | 'createdAt'>>
  ): SessionRecord;
  foldMessages(sessionId: string): SessionMessage[];
  listSurfaceNodes(sessionId: string): SurfaceNode[];
  hideRange(
    sessionId: string,
    startSeq: number,
    endSeq: number,
    opts?: { expectedWriterRunId?: string }
  ): SessionMessage;
}

export interface RewindResult {
  rewound: boolean;
  toSeq: number;
  shadowedCount: number;
  reason: string;
}

export function parseCheckpoints(metadata: Record<string, unknown> | undefined): StepCheckpoint[] {
  const raw = metadata?.[CHECKPOINTS_METADATA_KEY];
  if (!Array.isArray(raw)) return [];
  const out: StepCheckpoint[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.sessionId !== 'string') continue;
    if (typeof o.seq !== 'number' || !Number.isFinite(o.seq)) continue;
    out.push({
      id: o.id,
      sessionId: o.sessionId,
      seq: o.seq,
      turn: typeof o.turn === 'number' ? o.turn : -1,
      label: typeof o.label === 'string' ? o.label : '',
      createdAt: typeof o.createdAt === 'string' ? o.createdAt : ''
    });
  }
  return out;
}

export function latestCheckpoint(metadata: Record<string, unknown> | undefined): StepCheckpoint | undefined {
  const list = parseCheckpoints(metadata);
  return list[list.length - 1];
}

export function isClosedBoundary(folded: SessionMessage[]): boolean {
  if (folded.length === 0) return false;
  return !isToolWaveOpen(folded);
}

export function lastClosedSeq(nodes: SurfaceNode[], folded: SessionMessage[]): number | undefined {
  if (!isClosedBoundary(folded)) return undefined;
  const last = nodes[nodes.length - 1];
  return last?.seq;
}

export function saveStepCheckpoint(
  store: CheckpointStore,
  sessionId: string,
  input: { turn?: number; label?: string }
): CheckpointResult {
  const session = store.getSession(sessionId);
  if (!session) return { ok: false, reason: { kind: 'empty-log' } };
  const folded = store.foldMessages(sessionId);
  const nodes = store.listSurfaceNodes(sessionId);
  if (nodes.length === 0) return { ok: false, reason: { kind: 'empty-log' } };
  if (!isClosedBoundary(folded)) {
    return { ok: false, reason: { kind: 'not-closed-boundary' } };
  }
  const seq = nodes[nodes.length - 1]!.seq;
  const existing = parseCheckpoints(session.metadata);
  const last = existing[existing.length - 1];
  if (last && last.seq === seq) {
    return { ok: true, checkpoint: last };
  }
  const checkpoint: StepCheckpoint = {
    id: createId('ckpt'),
    sessionId,
    seq,
    turn: input.turn ?? existing.length,
    label: input.label ?? `step-${seq}`,
    createdAt: nowIso()
  };
  store.updateSession(sessionId, {
    metadata: {
      ...(session.metadata ?? {}),
      [CHECKPOINTS_METADATA_KEY]: [...existing, checkpoint]
    }
  });
  return { ok: true, checkpoint };
}

/**
 * Hide WAL visibility after the latest closed checkpoint (uncommitted tail).
 * No-op when already at the checkpoint or there is none.
 */
export function rewindUncommittedTail(
  store: CheckpointStore,
  sessionId: string,
  input: { reason: string; toSeq?: number; expectedWriterRunId?: string }
): RewindResult {
  const session = store.getSession(sessionId);
  const nodes = store.listSurfaceNodes(sessionId);
  const head = nodes[nodes.length - 1]?.seq ?? 0;
  const ckpt = input.toSeq != null
    ? parseCheckpoints(session?.metadata).find((c) => c.seq === input.toSeq)
    : latestCheckpoint(session?.metadata);
  const toSeq = ckpt?.seq ?? input.toSeq;
  if (toSeq == null || head <= toSeq) {
    return { rewound: false, toSeq: toSeq ?? 0, shadowedCount: 0, reason: input.reason };
  }
  const start = toSeq + 1;
  store.hideRange(sessionId, start, head, {
    expectedWriterRunId: input.expectedWriterRunId
  });
  return {
    rewound: true,
    toSeq,
    shadowedCount: head - toSeq,
    reason: input.reason
  };
}
