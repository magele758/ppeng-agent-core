import type { SqliteStateStore } from '../storage.js';
import { fetchTextEmbedding } from './embedding.js';
import { evolvingCoachEnabled, evolvingNamespaceFromSession } from './feature-flags.js';
import { formatAdvisoryFromCases, keywordsFromAbortReason, recallAgentCases } from './case-recall.js';

export async function buildEvolvingCoachAdvisory(
  env: NodeJS.ProcessEnv,
  store: SqliteStateStore,
  input: {
    sessionId: string;
    agentId: string;
    metadata: Record<string, unknown>;
    trigger: string;
    reason: string;
    queryText: string;
  }
): Promise<{ text: string; caseIds: string[] } | null> {
  if (!evolvingCoachEnabled(env)) return null;

  const ns = evolvingNamespaceFromSession(input.metadata);
  const keywords = keywordsFromAbortReason(input.reason);
  const limit = Math.min(8, Math.max(2, Number(env.RAW_AGENT_EVOLVING_COACH_TOP_K ?? '4') || 4));

  const qEmb = await fetchTextEmbedding(
    env,
    `${input.reason}\n${input.queryText}`.slice(0, 8000)
  );

  const cases = recallAgentCases(store.getAgentCaseStore(), {
    agentId: input.agentId,
    namespace: ns,
    keywords,
    queryText: input.queryText,
    limit
  }, qEmb);

  for (const c of cases) {
    store.incrementAgentCaseRecall(c.id);
  }

  const text = formatAdvisoryFromCases(cases, `${input.trigger}: ${input.reason}`);
  return { text, caseIds: cases.map((c) => c.id) };
}
