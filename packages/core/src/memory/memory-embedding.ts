/**
 * Optional OpenAI-compatible query embedding for memory hybrid recall.
 * 是否生效由 `config/effective-config.ts#resolveEmbeddingRecall` 推导（Lab 模式 auto/on/off + 上游配置），
 * 不是新的 RAW_AGENT_* 开关。Fail-open。
 */

import { resolveEmbeddingRecall, type MemoryEmbeddingMode } from '../config/effective-config.js';
import { fetchOpenAiEmbedding } from '../evolving/embedding.js';
import type { MemorySettings } from './memory-settings.js';

type EmbeddingSettings = Pick<MemorySettings, 'embeddingRecall'> & { embeddingRecallMode?: MemoryEmbeddingMode };

/** 老调用方只带布尔 `embeddingRecall`：true→on，false→off。 */
function modeOf(settings: EmbeddingSettings): MemoryEmbeddingMode {
  return settings.embeddingRecallMode ?? (settings.embeddingRecall ? 'on' : 'off');
}

export function memoryEmbeddingConfigured(env: NodeJS.ProcessEnv, settings: EmbeddingSettings): boolean {
  return resolveEmbeddingRecall(env, modeOf(settings)).enabled;
}

/** 是否值得尝试 embedding：显式 on（可注入 embedder，key 由 fetch 阶段再判），或 auto 且已配专用上游。 */
export function memoryEmbeddingRequested(env: NodeJS.ProcessEnv, settings: EmbeddingSettings): boolean {
  return modeOf(settings) === 'on' || memoryEmbeddingConfigured(env, settings);
}

export async function fetchMemoryQueryEmbedding(
  env: NodeJS.ProcessEnv,
  text: string,
  settings: EmbeddingSettings,
  signal?: AbortSignal
): Promise<number[] | null> {
  if (!memoryEmbeddingConfigured(env, settings)) return null;
  try {
    return await fetchOpenAiEmbedding(env, text, signal);
  } catch {
    return null;
  }
}
