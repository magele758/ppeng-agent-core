/**
 * HTTP mapping for POST /api/sessions/:id/steer.
 *
 * Core `enqueueSteer` / `loop.steer()` still return void / InboxItem on main.
 * This layer projects a forward-compatible receipt so Lab can show
 * 已提交 / 未受理 before SteerAck lands in core (Started | Steered | NotSubmitted).
 */

export type SteerAckStatus = 'steered' | 'not_submitted';
export type SteerAckReason = 'no_session' | 'session_ended';

export interface SteerSessionLike {
  id: string;
  status: string;
}

export interface SteerHttpAck<TItem = unknown, TSession extends SteerSessionLike = SteerSessionLike> {
  ok: boolean;
  status: SteerAckStatus;
  reason?: SteerAckReason;
  item?: TItem;
  session?: TSession;
}

export function sessionAcceptsSteer(
  session: SteerSessionLike | undefined | null
): { accept: true; session: SteerSessionLike } | { accept: false; reason: SteerAckReason } {
  if (!session) return { accept: false, reason: 'no_session' };
  if (session.status === 'completed' || session.status === 'failed') {
    return { accept: false, reason: 'session_ended' };
  }
  return { accept: true, session };
}

export function steeredAck<TItem, TSession extends SteerSessionLike>(
  item: TItem,
  session: TSession
): SteerHttpAck<TItem, TSession> {
  return { ok: true, status: 'steered', item, session };
}

export function notSubmittedAck<TSession extends SteerSessionLike>(
  reason: SteerAckReason,
  session?: TSession
): SteerHttpAck<never, TSession> {
  return {
    ok: false,
    status: 'not_submitted',
    reason,
    ...(session ? { session } : {})
  };
}
