/**
 * Reduce JSON Schema verbosity for MCP-expanded tools before sending schemas to the LLM
 * (similar in spirit to MCP Spine schema minification — fewer tokens, types preserved).
 *
 * Levels:
 * - 0: passthrough
 * - 1: strip meta noise ($schema, $id, title, examples, …)
 * - 2+: also strip descriptions, defaults, additionalProperties
 */

function walk(node: unknown, level: number): unknown {
  if (node === null || typeof node !== 'object') {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map((x) => walk(x, level));
  }
  const o = node as Record<string, unknown>;
  const stripMeta = new Set(['$schema', '$id', 'title', 'examples', '$comment']);
  const stripHeavy = new Set(['description', 'default', 'additionalProperties']);
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (level >= 1 && stripMeta.has(k)) {
      continue;
    }
    if (level >= 2 && stripHeavy.has(k)) {
      continue;
    }
    next[k] = walk(v, level);
  }
  return next;
}

export function minifyMcpToolInputSchema(schema: Record<string, unknown>, level: number): Record<string, unknown> {
  if (level <= 0) {
    return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  }
  const clone = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  return walk(clone, level) as Record<string, unknown>;
}

/** 0 = off, 1 = light (default), 2 = aggressive. Invalid values fall back to 1. */
export function parseMcpSchemaMinifyLevel(env: NodeJS.ProcessEnv): number {
  const raw = env.RAW_AGENT_MCP_SCHEMA_MINIFY?.trim();
  if (raw === undefined || raw === '') {
    return 1;
  }
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0 && n <= 3) {
    return Math.floor(n);
  }
  return 1;
}
