/**
 * Steer may spawn a parallel child session (reuse spawn_subagent contract).
 * Parent soft-complete waits until children are idle.
 */

import { formatSubagentSummary, resolveSubagentAgentId } from './subagent-contract.js';
import type { SessionRecord } from '../types.js';

export const STEERING_CHILDREN_KEY = 'steeringChildren';

export interface SteeringChildRef {
  sessionId: string;
  steerId: string;
  role?: string;
  status: 'running' | 'idle' | 'failed';
}

export type SteeringSpawnFn = (input: {
  parentSessionId: string;
  prompt: string;
  role?: string;
}) => { sessionId: string; done: Promise<void> };

const waiters = new Map<string, Promise<void>[]>();

export function parseSteeringChildren(metadata: Record<string, unknown> | undefined): SteeringChildRef[] {
  const raw = metadata?.[STEERING_CHILDREN_KEY];
  if (!Array.isArray(raw)) return [];
  const out: SteeringChildRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.sessionId !== 'string' || typeof o.steerId !== 'string') continue;
    const status =
      o.status === 'idle' || o.status === 'failed' || o.status === 'running' ? o.status : 'running';
    out.push({
      sessionId: o.sessionId,
      steerId: o.steerId,
      role: typeof o.role === 'string' ? o.role : undefined,
      status
    });
  }
  return out;
}

export function mergeSteeringChild(
  metadata: Record<string, unknown>,
  child: SteeringChildRef
): Record<string, unknown> {
  const prev = parseSteeringChildren(metadata).filter((c) => c.sessionId !== child.sessionId);
  return { ...metadata, [STEERING_CHILDREN_KEY]: [...prev, child] };
}

export function formatSteeringSubagentResult(input: {
  agentName: string;
  agentId: string;
  steerId: string;
  content: string;
  prompt?: string;
}): string {
  const promptAttr = input.prompt?.trim()
    ? ` prompt="${input.prompt.trim().replace(/"/g, '&quot;')}"`
    : '';
  return (
    `<subagent_steering_result agent="${input.agentName}" agent_id="${input.agentId}" id="${input.steerId}"${promptAttr}>\n` +
    `${input.content}\n` +
    `</subagent_steering_result>`
  );
}

export function trackSteeringWait(parentId: string, done: Promise<void>): void {
  const list = waiters.get(parentId) ?? [];
  list.push(done.catch(() => undefined));
  waiters.set(parentId, list);
}

export async function waitSteeringChildrenIdle(parentId: string): Promise<void> {
  const list = waiters.get(parentId) ?? [];
  if (list.length === 0) return;
  await Promise.allSettled(list);
  waiters.delete(parentId);
}

export function hasPendingSteeringChildren(metadata: Record<string, unknown> | undefined): boolean {
  return parseSteeringChildren(metadata).some((c) => c.status === 'running');
}

export function startSteeringSubagent(input: {
  spawn: SteeringSpawnFn;
  parent: SessionRecord;
  prompt: string;
  steerId: string;
  role?: string;
}): { child: SteeringChildRef; done: Promise<void> } {
  const { sessionId, done } = input.spawn({
    parentSessionId: input.parent.id,
    prompt: input.prompt,
    role: input.role
  });
  const child: SteeringChildRef = {
    sessionId,
    steerId: input.steerId,
    role: input.role,
    status: 'running'
  };
  trackSteeringWait(input.parent.id, done);
  return { child, done };
}

export { formatSubagentSummary, resolveSubagentAgentId };
