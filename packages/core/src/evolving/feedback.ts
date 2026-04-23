import type { SqliteStateStore } from '../storage.js';
import { evolvingMasterEnabled } from './feature-flags.js';

/**
 * After a successful turn following an evolving coach advisory, nudge case confidence up.
 */
export function applyEvolvingPositiveFeedback(
  env: NodeJS.ProcessEnv,
  store: SqliteStateStore,
  sessionId: string,
  delta?: number
): void {
  if (!evolvingMasterEnabled(env)) return;
  const session = store.getSession(sessionId);
  if (!session) return;
  const raw = session.metadata.evolvingPendingCaseIds;
  if (!Array.isArray(raw) || raw.length === 0) return;

  const d = typeof delta === 'number' ? delta : Number(env.RAW_AGENT_EVOLVING_FEEDBACK_DELTA ?? '0.06') || 0.06;
  for (const id of raw.map(String).filter(Boolean)) {
    store.bumpAgentCaseConfidence(id, d);
  }

  const nextMeta = { ...session.metadata, evolvingPendingCaseIds: [] };
  store.updateSession(sessionId, { metadata: nextMeta });
}
