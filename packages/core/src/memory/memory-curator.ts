/**
 * MemoryCurator — consume task-end observations, gate, then accept/merge/drop.
 * Modes: inline (async, fail-soft) | observe_only | off.
 */

import { createLogger } from '../logger.js';
import { evaluateMemoryWrite, isTrivialChitchat, meetsTaskExperienceDepth } from './memory-gate.js';
import { resolveMemorySettings, type MemoryCuratorMode } from './memory-settings.js';
import type { AgentMemoryStore } from './store.js';
import type { MemoryObservation } from './types.js';

const log = createLogger('memory-curator');

export interface TaskEndObservationInput {
  sessionId: string;
  taskContent: string;
  outcome: 'success' | 'failure' | 'partial';
  toolsUsed?: string[];
  userId?: string;
  agentId?: string;
  tenantId?: string;
  rawSummary?: string;
}

export interface TaskEndObservationResult {
  obs: MemoryObservation | null;
  tailPromise: Promise<void> | null;
}

export function publishTaskEndObservation(
  store: AgentMemoryStore,
  input: TaskEndObservationInput,
  opts?: {
    settingsStore?: { getDaemonControl?(key: string): unknown };
    afterAccept?: (obs: MemoryObservation) => void | Promise<void>;
  }
): TaskEndObservationResult {
  const settings = resolveMemorySettings(opts?.settingsStore);
  const mode: MemoryCuratorMode = settings.curatorMode;
  if (mode === 'off') return { obs: null, tailPromise: null };

  const obs = store.insertObservation({
    kind: 'task_end',
    sessionId: input.sessionId,
    userId: input.userId,
    agentId: input.agentId,
    tenantId: input.tenantId,
    taskContent: input.taskContent,
    outcome: input.outcome,
    toolsUsed: input.toolsUsed ?? [],
    rawSummary: input.rawSummary,
    gate: 'pending'
  });

  if (mode === 'observe_only') {
    store.updateObservation(obs.id, { gate: 'skipped', gateReason: 'observe_only' });
    return { obs: { ...obs, gate: 'skipped', gateReason: 'observe_only' }, tailPromise: null };
  }

  const tailPromise = curateTaskEnd(store, obs, {
    minTaskTools: settings.minTaskTools,
    afterAccept: opts?.afterAccept
  }).then(
    () => undefined,
    (e) => {
      log.warn(`curateTaskEnd failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  );
  return { obs, tailPromise };
}

export async function curateTaskEnd(
  store: AgentMemoryStore,
  obs: MemoryObservation,
  opts?: {
    minTaskTools?: number;
    afterAccept?: (obs: MemoryObservation) => void | Promise<void>;
  }
): Promise<string> {
  const reject = (reason: string) => {
    store.updateObservation(obs.id, { gate: 'rejected', gateReason: reason });
    return '';
  };

  const task = (obs.taskContent || '').trim();
  const content = (obs.rawSummary || task).trim();
  if (!task && !content) return reject('empty_task');
  if (isTrivialChitchat(task)) return reject('gate_trivial_chitchat');
  if (!meetsTaskExperienceDepth({ toolsUsed: obs.toolsUsed, minTaskTools: opts?.minTaskTools })) {
    return reject('gate_shallow_execution');
  }

  const gate = evaluateMemoryWrite({
    value: content,
    taskContent: task,
    kind: 'task',
    toolsUsed: obs.toolsUsed,
    minTaskTools: opts?.minTaskTools,
    outcome: obs.outcome
  });
  if (!gate.allow) return reject(gate.reason);

  const userId = (obs.userId || '').trim();
  if (!userId) return reject('missing_user');

  const entry = store.set({
    scope: 'user.memory',
    namespace: 'episodic',
    key: `task:${obs.sessionId ?? 'na'}:${Date.now().toString(36)}`,
    value: content.slice(0, 400),
    userId,
    tenantId: obs.tenantId,
    sessionId: obs.sessionId,
    importance: obs.outcome === 'success' ? 0.6 : 0.45,
    source: 'curator',
    confidence: 'medium'
  });

  const gateStatus = 'accepted' as const;
  store.updateObservation(obs.id, {
    gate: gateStatus,
    gateReason: 'curated_inline',
    writtenMemoryId: entry.id
  });

  if (opts?.afterAccept) {
    void Promise.resolve(opts.afterAccept({ ...obs, gate: gateStatus, writtenMemoryId: entry.id })).catch((e) => {
      log.warn(`afterAccept failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  }
  return entry.id;
}
