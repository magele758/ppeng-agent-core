import { createHash } from 'node:crypto';

/** Recursively sort object keys for deterministic JSON serialization. */
export function sortKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  return Object.keys(obj as Record<string, unknown>)
    .sort()
    .reduce((acc, key) => {
      acc[key] = sortKeys((obj as Record<string, unknown>)[key]);
      return acc;
    }, {} as Record<string, unknown>);
}

/** Deterministic JSON serialization for idempotency hashing (deep sorted keys). */
export function stableJsonHash(toolName: string, input: unknown): string {
  const stable = JSON.stringify(sortKeys(input));
  return createHash('sha256').update(`${toolName}:${stable}`).digest('hex').slice(0, 32);
}

/** Safely extract a string field from tool call input. */
export function extractInputString(input: unknown, key: string): string {
  if (typeof input === 'object' && input && key in input) {
    return String((input as Record<string, unknown>)[key] ?? '');
  }
  return '';
}
