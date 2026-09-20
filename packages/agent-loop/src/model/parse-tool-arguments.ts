import { jsonrepair } from 'jsonrepair';

/**
 * Parse model-emitted tool call `function.arguments` (often malformed JSON).
 * Tries JSON.parse, then jsonrepair + JSON.parse; on total failure returns `{ raw: string }`.
 */
export function parseModelToolArguments(raw: string | undefined | null): Record<string, unknown> {
  const s = String(raw ?? '').trim() || '{}';
  try {
    return normalizeToolArgsObject(JSON.parse(s));
  } catch {
    try {
      const repaired = jsonrepair(s);
      return normalizeToolArgsObject(JSON.parse(repaired));
    } catch {
      return { raw: s };
    }
  }
}

function normalizeToolArgsObject(parsed: unknown): Record<string, unknown> {
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return { _nonObject: parsed as unknown };
}
