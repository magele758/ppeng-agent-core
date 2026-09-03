/**
 * Turn-end evolving coach + task completion, extracted from RawAgentRuntime.
 */

import {
  applyEvolvingPositiveFeedback,
  buildEvolvingCoachAdvisory,
  evolvingReviewerEnabled,
  scheduleBackgroundCaseReview
} from '../evolving/index.js';
import { evolvingQueryText } from '../evolving/query-text.js';
import {
  appendWorkingLogEntry,
  workingLogEnabled,
  workingLogPath
} from '../session/working-log.js';
import type { SqliteStateStore } from '../storage.js';
import type { TraceEvent } from '../stores/trace.js';
import type { SessionRecord, TaskRecord } from '../types.js';
import { getLatestAssistantText, textPart } from './session-facade.js';
import { unblockDependentTasks } from './scheduler-host.js';
import { scheduleMemoryTurnEnd } from '../memory/memory-turn-end.js';

export interface SessionCompleteHost {
  store: SqliteStateStore;
  stateDir: string;
  emitTrace(sessionId: string, event: Omit<TraceEvent, 'ts' | 'sessionId'>): void;
  mergeSessionMetadata(sessionId: string, patch: Record<string, unknown>): SessionRecord;
}

export async function handleTurnCompletion(
  host: SessionCompleteHost,
  session: SessionRecord,
  agent: { id: string },
  task?: TaskRecord
): Promise<SessionRecord> {
  applyEvolvingPositiveFeedback(process.env, host.store, session.id);
  const nextStatus = session.mode === 'task' ? 'completed' : 'idle';
  const updated = host.store.updateSession(session.id, { status: nextStatus });
  if (workingLogEnabled(process.env)) {
    const outcomeText = getLatestAssistantText(host.store, session.id);
    if (outcomeText?.trim()) {
      appendWorkingLogEntry(workingLogPath(host.stateDir, session.id), {
        kind: 'step_outcome',
        content: outcomeText.trim().slice(0, 2_000)
      });
    }
  }
  if (task && nextStatus === 'completed') {
    const latestText = getLatestAssistantText(host.store, session.id);
    host.store.updateTask(task.id, {
      status: 'completed',
      artifacts: latestText
        ? [...task.artifacts, { kind: 'summary', label: 'assistant', value: latestText }]
        : task.artifacts
    });
    host.store.appendEvent({
      taskId: task.id,
      kind: 'task.completed',
      actor: agent.id,
      payload: { sessionId: session.id }
    });
    await unblockDependentTasks(host.store, task.id);
  }
  if (evolvingReviewerEnabled(process.env)) {
    scheduleBackgroundCaseReview(host.store, process.env, {
      stateDir: host.stateDir,
      sessionId: session.id,
      agentId: agent.id,
      outcome: 'success'
    });
  }
  try {
    scheduleMemoryTurnEnd({
      store: host.store.agentMemory(),
      settingsStore: host.store,
      session: updated,
      messages: host.store.foldMessages(session.id),
      agentId: agent.id,
      assistantText: getLatestAssistantText(host.store, session.id),
      stateDir: host.stateDir
    });
  } catch {
    /* fail-soft */
  }
  return updated;
}

export async function injectEvolvingCoachBeforeRecovery(
  host: SessionCompleteHost,
  session: SessionRecord,
  agent: { id: string },
  trigger: string,
  reason: string
): Promise<void> {
  const advisory = await buildEvolvingCoachAdvisory(process.env, host.store, {
    sessionId: session.id,
    agentId: agent.id,
    metadata: session.metadata ?? {},
    trigger,
    reason,
    queryText: evolvingQueryText(host.store, session.id)
  });
  if (!advisory?.text.trim()) return;
  host.store.appendMessage(session.id, 'system', [textPart(advisory.text)]);
  if (advisory.caseIds.length) {
    host.mergeSessionMetadata(session.id, { evolvingPendingCaseIds: advisory.caseIds });
  }
  void host.emitTrace(session.id, {
    kind: 'evolving_coach',
    payload: { caseIds: advisory.caseIds, trigger }
  });
}
