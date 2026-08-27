/**
 * Lab/HTTP projection of core `SteerAck`.
 *
 * Wire: `{ ok, status: queued | steered | rejected }` on HTTP 200
 * (`api()` treats 4xx as errors; rejected must not throw).
 * Core `started` → queued; `steered` → steered; `not_submitted` → rejected.
 */

import { steerAckToHttp, type SteerAck } from '@ppeng/agent-core';
import type { NotSubmittedReason, SessionRecord } from '@ppeng/agent-core';

export type SteerHttpStatus = 'queued' | 'steered' | 'rejected';

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
  const mapped = steerAckToHttp(ack);
  if (mapped.status === 'rejected') {
    return {
      ok: false,
      status: 'rejected',
      reason: mapped.reason,
      ...(session ? { session } : {})
    };
  }
  return {
    ok: true,
    status: mapped.status,
    item: mapped.item,
    ...(session ? { session } : {})
  };
}
