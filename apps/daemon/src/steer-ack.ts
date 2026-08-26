/**
 * Lab/HTTP projection of core `SteerAck`.
 *
 * Core: `started` | `steered` | `not_submitted`.
 * Lab contract stays `{ ok, status: steered | not_submitted }` on HTTP 200
 * (`api()` treats 4xx as errors; 未受理 must not throw).
 * Idle `started` maps to Lab `steered` (已提交 · 下一枪生效).
 */

import type { NotSubmittedReason, SessionRecord, SteerAck } from '@ppeng/agent-core';

export type SteerHttpStatus = 'steered' | 'not_submitted';

export interface SteerHttpAck<TItem = unknown, TSession = SessionRecord> {
  ok: boolean;
  status: SteerHttpStatus;
  reason?: NotSubmittedReason;
  item?: TItem;
  session?: TSession;
}

export function steerHttpFromCoreAck(
  ack: SteerAck,
  session?: SessionRecord | null
): SteerHttpAck {
  switch (ack.status) {
    case 'not_submitted':
      return {
        ok: false,
        status: 'not_submitted',
        reason: ack.reason,
        ...(session ? { session } : {})
      };
    case 'started':
    case 'steered':
      return {
        ok: true,
        status: 'steered',
        item: ack.item,
        ...(session ? { session } : {})
      };
    default: {
      const _never: never = ack;
      return _never;
    }
  }
}
