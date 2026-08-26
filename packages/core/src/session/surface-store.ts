/**
 * L1 contract: append-only WAL + fold. SQLite is one implementation.
 * Phase 1 extracts the interface only — no writer claim / memory store (later phases).
 */

import type { MessageRole, SessionMessage, SessionRecord } from '../types.js';
import type { InboxItem, InboxTarget, EnqueueSteerOptions } from './step-inbox.js';
import type { SurfaceNode } from './surface-invariants.js';

export interface SurfaceReplacementInput {
  startSeq: number;
  endSeq: number;
  role: MessageRole;
  parts: SessionMessage['parts'];
  key?: string;
}

/**
 * Session surface store: append / replace / hide / fold + inbox claim.
 * Implementations must keep WAL append-only; fold is the model packing view.
 */
export interface SessionSurfaceStore {
  getSession(id: string): SessionRecord | undefined;
  appendMessage(
    sessionId: string,
    role: MessageRole,
    parts: SessionMessage['parts'],
    opts?: { key?: string }
  ): SessionMessage;
  appendReplacement(sessionId: string, input: SurfaceReplacementInput): SessionMessage;
  hideByKey(sessionId: string, key: string): number;
  hideRange(sessionId: string, startSeq: number, endSeq: number): SessionMessage;
  foldMessages(sessionId: string): SessionMessage[];
  listSurfaceNodes(sessionId: string): SurfaceNode[];
  enqueueSteer(sessionId: string, text: string, opts?: EnqueueSteerOptions): InboxItem;
  claimInbox(sessionId: string, target: InboxTarget): InboxItem[];
}
