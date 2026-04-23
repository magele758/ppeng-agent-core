import { envBool } from '../env.js';

export function evolvingEmbeddingsEnabled(env: NodeJS.ProcessEnv): boolean {
  return envBool(env, 'RAW_AGENT_EVOLVING_EMBEDDINGS', false);
}

/** Cosine similarity in [0,1] (1 = identical direction). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  if (d === 0) return 0;
  const c = dot / d;
  return (c + 1) / 2;
}

/**
 * OpenAI-compatible POST /embeddings. Returns null on failure / disabled.
 */
export async function fetchTextEmbedding(
  env: NodeJS.ProcessEnv,
  text: string,
  signal?: AbortSignal
): Promise<number[] | null> {
  if (!evolvingEmbeddingsEnabled(env)) return null;
  const model =
    env.RAW_AGENT_EMBEDDING_MODEL?.trim() ||
    env.RAW_AGENT_MODEL_NAME?.trim() ||
    'text-embedding-3-small';
  const baseUrl = (env.RAW_AGENT_EMBEDDING_BASE_URL ?? env.RAW_AGENT_BASE_URL ?? '').trim().replace(/\/$/, '');
  const apiKey = (env.RAW_AGENT_EMBEDDING_API_KEY ?? env.RAW_AGENT_API_KEY ?? '').trim();
  if (!baseUrl || !apiKey) return null;
  const t = text.slice(0, 8000);
  try {
    const res = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model, input: t }),
      signal
    });
    const raw = await res.text();
    if (!res.ok) return null;
    const parsed = JSON.parse(raw) as { data?: Array<{ embedding?: number[] }> };
    const emb = parsed.data?.[0]?.embedding;
    if (!Array.isArray(emb) || !emb.every((x) => typeof x === 'number')) return null;
    return emb;
  } catch {
    return null;
  }
}
