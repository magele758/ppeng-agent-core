/**
 * Optional OpenAI-compatible query embedding for memory hybrid recall.
 * Gated by Lab memory settings (`embeddingRecall`), not a new RAW_AGENT_* flag.
 * Upstream key / base URL reuse existing embedding or chat env. Fail-open.
 */

import { fetchOpenAiEmbedding } from '../evolving/embedding.js';
import type { MemorySettings } from './memory-settings.js';

export function memoryEmbeddingConfigured(
  env: NodeJS.ProcessEnv,
  settings: Pick<MemorySettings, 'embeddingRecall'>
): boolean {
  if (!settings.embeddingRecall) return false;
  const baseUrl = (env.RAW_AGENT_EMBEDDING_BASE_URL ?? env.RAW_AGENT_BASE_URL ?? '').trim();
  const apiKey = (env.RAW_AGENT_EMBEDDING_API_KEY ?? env.RAW_AGENT_API_KEY ?? '').trim();
  return Boolean(baseUrl && apiKey);
}

export async function fetchMemoryQueryEmbedding(
  env: NodeJS.ProcessEnv,
  text: string,
  settings: Pick<MemorySettings, 'embeddingRecall'>,
  signal?: AbortSignal
): Promise<number[] | null> {
  if (!memoryEmbeddingConfigured(env, settings)) return null;
  try {
    return await fetchOpenAiEmbedding(env, text, signal);
  } catch {
    return null;
  }
}
