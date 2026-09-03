/**
 * Executable invariants over real transcript / goal / session types.
 * These are predicates + checkers, not a temporal-logic monitor and not wired
 * into AgentLoop (see ai-agent-node formal postmortem: no half-wired LTL).
 */

import { unmatchedToolCallIds } from '../session/surface-invariants.js';
import type { MessagePart, SessionMessage, SessionStatus } from '../types.js';
import {
  GOAL_EVENTS,
  GOAL_STATUSES,
  listGoalTransitions,
  transitionGoal,
  type GoalTransitionEvent
} from '../goal/goal-state-machine.js';
import type { GoalStatusValue } from '../goal/types.js';
import { isLegalSessionTransition, type SessionLifecycleEvent } from './session-lifecycle.js';

export type FormalCheck = { id: string; ok: boolean; detail?: string };

export function checkToolCallPairing(messages: Array<{ parts: MessagePart[] }>): FormalCheck {
  const open = unmatchedToolCallIds(messages);
  return {
    id: 'tool_call_pairing',
    ok: open.length === 0,
    detail: open.length ? `unmatched tool_call: ${open.join(', ')}` : undefined
  };
}

export function checkNoOrphanToolResults(messages: Array<{ parts: MessagePart[] }>): FormalCheck {
  const seenCalls = new Set<string>();
  const orphans: string[] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === 'tool_call') seenCalls.add(part.toolCallId);
      else if (part.type === 'tool_result' && !seenCalls.has(part.toolCallId)) {
        orphans.push(part.toolCallId);
      }
    }
  }
  return {
    id: 'no_orphan_tool_result',
    ok: orphans.length === 0,
    detail: orphans.length ? `tool_result without prior tool_call: ${orphans.join(', ')}` : undefined
  };
}

export function checkAssistantToolUseShape(messages: SessionMessage[]): FormalCheck {
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    const calls = m.parts.filter((p) => p.type === 'tool_call');
    const texts = m.parts.filter((p) => p.type === 'text' && p.text.trim());
    if (calls.length > 0 && texts.length > 0) {
      return {
        id: 'assistant_tool_use_shape',
        ok: true,
        detail: 'assistant mixed text+tool_call (allowed)'
      };
    }
  }
  return { id: 'assistant_tool_use_shape', ok: true };
}

export function checkTranscriptInvariants(messages: SessionMessage[]): FormalCheck[] {
  return [checkToolCallPairing(messages), checkNoOrphanToolResults(messages), checkAssistantToolUseShape(messages)];
}

export function assertTranscriptInvariants(messages: SessionMessage[]): void {
  const failed = checkTranscriptInvariants(messages).filter((c) => !c.ok);
  if (failed.length) {
    throw new Error(`transcript invariants failed: ${failed.map((c) => c.detail ?? c.id).join('; ')}`);
  }
}

export function checkGoalTransition(from: GoalStatusValue, event: GoalTransitionEvent): FormalCheck {
  try {
    transitionGoal(from, event);
    return { id: 'goal_transition', ok: true };
  } catch (e) {
    return {
      id: 'goal_transition',
      ok: false,
      detail: e instanceof Error ? e.message : String(e)
    };
  }
}

export function checkSessionTransition(from: SessionStatus, event: SessionLifecycleEvent): FormalCheck {
  return {
    id: 'session_transition',
    ok: isLegalSessionTransition(from, event),
    detail: isLegalSessionTransition(from, event) ? undefined : `${from} --${event}--> illegal`
  };
}

/** Exhaustive walk of the Goal SM table from the implementation (source of truth). */
export function enumerateGoalMachine(): {
  legal: ReturnType<typeof listGoalTransitions>;
  illegal: Array<{ from: GoalStatusValue; event: GoalTransitionEvent }>;
} {
  const legal = listGoalTransitions();
  const legalSet = new Set(legal.map((e) => `${e.from}|${e.event}`));
  const illegal: Array<{ from: GoalStatusValue; event: GoalTransitionEvent }> = [];
  for (const from of GOAL_STATUSES) {
    for (const event of GOAL_EVENTS) {
      if (!legalSet.has(`${from}|${event}`)) illegal.push({ from, event });
    }
  }
  return { legal, illegal };
}
