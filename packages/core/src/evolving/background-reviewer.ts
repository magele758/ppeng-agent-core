import type { SqliteStateStore } from '../storage.js';
import type { SessionMessage } from '../types.js';
import { textSummaryFromParts } from '../model/model-adapters.js';
import { createLogger } from '../logger.js';
import { appendTraceEvent } from '../stores/trace.js';
import { envInt } from '../env.js';
import { fetchTextEmbedding, evolvingEmbeddingsEnabled } from './embedding.js';
import { evolvingNamespaceFromSession, evolvingReviewerEnabled } from './feature-flags.js';
import { runReviewerLlm } from './reviewer-llm.js';

const log = createLogger('evolving-reviewer');
const sessionLocks = new Map<string, Promise<void>>();

function sampleMessagesForReview(messages: SessionMessage[]): string {
  const lines: string[] = [];
  const firstUser = messages.find((m) => m.role === 'user');
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const assistants = messages.filter((m) => m.role === 'assistant');
  const lastAsst = assistants[assistants.length - 1];
  if (firstUser) lines.push(`FIRST_USER: ${textSummaryFromParts(firstUser.parts).slice(0, 1500)}`);
  if (lastUser && lastUser !== firstUser) {
    lines.push(`LAST_USER: ${textSummaryFromParts(lastUser.parts).slice(0, 1500)}`);
  }
  if (lastAsst) {
    lines.push(`LAST_ASSISTANT: ${textSummaryFromParts(lastAsst.parts).slice(0, 2000)}`);
  }
  const toolFails: string[] = [];
  for (const m of messages) {
    if (m.role !== 'tool') continue;
    for (const p of m.parts) {
      if (p.type === 'tool_result' && p.ok === false) {
        toolFails.push(`${p.name}: ${String(p.content).slice(0, 400)}`);
      }
    }
  }
  if (toolFails.length) lines.push(`TOOL_ERRORS:\n${toolFails.slice(-6).join('\n')}`);
  return lines.join('\n\n');
}

export interface ScheduleCaseReviewInput {
  stateDir: string;
  sessionId: string;
  agentId: string;
  outcome: 'success' | 'failure' | 'partial';
  signals?: Record<string, unknown>;
}

/**
 * Fire-and-forget: one in-flight reviewer per session; failures are swallowed.
 */
export function scheduleBackgroundCaseReview(
  store: SqliteStateStore,
  env: NodeJS.ProcessEnv,
  input: ScheduleCaseReviewInput
): void {
  if (!evolvingReviewerEnabled(env)) return;

  const timeoutMs = envInt(env, 'RAW_AGENT_EVOLVING_REVIEWER_TIMEOUT_MS', 45_000);
  const prev = sessionLocks.get(input.sessionId);
  const run = (async () => {
    if (prev) {
      try {
        await prev;
      } catch {
        /* ignore */
      }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const session = store.getSession(input.sessionId);
      if (!session) return;
      const messages = store.listMessages(input.sessionId);
      if (messages.length < 2) return;

      const pack = sampleMessagesForReview(messages);
      const userPayload = JSON.stringify(
        {
          outcome: input.outcome,
          signals: input.signals ?? {},
          excerpts: pack
        },
        null,
        0
      );

      const parsed = await runReviewerLlm(env, userPayload, controller.signal);
      if (!parsed || parsed.skip === true) return;

      const fingerprint = String(parsed.task_fingerprint ?? '').trim().slice(0, 80) || 'unknown';
      const outcomeRaw = String(parsed.outcome ?? input.outcome);
      const outcome =
        outcomeRaw === 'success' || outcomeRaw === 'failure' || outcomeRaw === 'partial'
          ? outcomeRaw
          : input.outcome;

      let embedding: number[] | null = null;
      if (evolvingEmbeddingsEnabled(env)) {
        const embText = [fingerprint, parsed.what_worked, parsed.pivot_hint].filter(Boolean).join('\n');
        embedding = await fetchTextEmbedding(env, embText, controller.signal);
      }

      const ns = evolvingNamespaceFromSession(session.metadata);

      store.insertAgentCase({
        namespace: ns,
        sessionId: input.sessionId,
        agentId: input.agentId,
        taskFingerprint: fingerprint,
        outcome,
        signals: input.signals,
        whatWorked: typeof parsed.what_worked === 'string' ? parsed.what_worked : undefined,
        whatFailed: typeof parsed.what_failed === 'string' ? parsed.what_failed : undefined,
        pivotHint: typeof parsed.pivot_hint === 'string' ? parsed.pivot_hint : undefined,
        applicableWhen: typeof parsed.applicable_when === 'string' ? parsed.applicable_when : undefined,
        notApplicableWhen: typeof parsed.not_applicable_when === 'string' ? parsed.not_applicable_when : undefined,
        source: 'reviewer',
        embedding
      });

      void appendTraceEvent(input.stateDir, input.sessionId, {
        kind: 'evolving_case',
        payload: { fingerprint }
      });
    } catch (e) {
      log.debug('reviewer failed', e);
    } finally {
      clearTimeout(timer);
      sessionLocks.delete(input.sessionId);
    }
  })();

  sessionLocks.set(input.sessionId, run);
  void run;
}
