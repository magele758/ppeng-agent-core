import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { EventBufferRepository } from '../storage/interfaces.js';

export type TraceEventKind =
  | 'turn_start'
  | 'turn_end'
  /** Model output cut off by a token cap (finish_reason length / max_tokens); content is incomplete */
  | 'turn_truncated'
  | 'tool_start'
  | 'tool_end'
  | 'model_error'
  | 'compact'
  | 'compact_skipped'
  | 'cancel'
  /** load_skill 是否在当轮 routing shortlist 内（用于观测漏召回 / 误选） */
  | 'skill_load'
  | 'otel_proxy'
  /** refusal-preservation guard fired: prior refusal + redirect detected */
  | 'refusal_preservation'
  /** Session loop guard: repetition, tool failures, or same-tool streak */
  | 'recovery_abort'
  /** Loop guard would abort but AdvisoryGrace consumed a budget slot */
  | 'recovery_advisory'
  /** RiskEngine enqueued a multi-signal advisory */
  | 'risk_advisory'
  /** Goal soft-gate evaluation at soft-complete */
  | 'goal_eval'
  /** Evolving: background reviewer persisted a case */
  | 'evolving_case'
  /** Evolving: shadow coach injected advisory */
  | 'evolving_coach'
  /** Prompt-cache toolset fingerprint drifted mid-session */
  | 'prompt_cache_bust'
  /** Intra-turn stream watchdog: output degenerated into repetition */
  | 'repetition_abort'
  /** Consecutive reasoning-only / empty turns (no tool call, no text) */
  | 'reasoning_spin_abort'
  /** Per-turn micro-compact shrank older tool results in place */
  | 'micro_compact'
  /** Provider reported cumulative prompt tokens; normalized to this turn's share */
  | 'usage_cumulative_split'
  /** Working log entry appended (compact anchor / step outcome) */
  | 'working_log_append'
  /** Optional post-fold history budget dropped seqs (never silent) */
  | 'fold_budget_drop'
  /** Capability Registry: card registered / upserted */
  | 'capability_register'
  /** Capability Registry: trust or binding state change */
  | 'capability_state_change'
  /** Tailscale inventory probe produced candidate cards */
  | 'capability_tailscale_inventory'
  /** Tool Search / load_capability_tool disclosure */
  | 'capability_tool_search'
  /** CBOM schema pin mismatch blocked execution */
  | 'capability_pin_fail'

export interface TraceEvent {
  ts: string;
  sessionId: string;
  kind: TraceEventKind;
  payload?: Record<string, unknown>;
}

export type AppendTraceCloudOptions = {
  eventBuffer: EventBufferRepository;
  tenantId: string;
  userId: string;
};

export async function appendTraceEvent(
  stateDir: string,
  sessionId: string,
  event: Omit<TraceEvent, 'ts' | 'sessionId'>,
  cloud?: AppendTraceCloudOptions
): Promise<void> {
  const dir = join(stateDir, 'traces', sessionId);
  await mkdir(dir, { recursive: true });
  const line: TraceEvent = {
    ts: new Date().toISOString(),
    sessionId,
    ...event
  };
  const file = join(dir, 'events.jsonl');
  await appendFile(file, `${JSON.stringify(line)}\n`, 'utf8');

  if (cloud?.eventBuffer) {
    void cloud.eventBuffer
      .appendEvent({
        tenantId: cloud.tenantId,
        userId: cloud.userId,
        sessionId,
        eventType: `trace:${event.kind}`,
        payload: { ...(event.payload ?? {}), kind: event.kind },
      })
      .catch(() => {});
  }
}
