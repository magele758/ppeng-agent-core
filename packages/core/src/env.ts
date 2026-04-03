/**
 * Parse an integer env var with a positive-value guard and floor.
 * Returns `fallback` when the value is missing, not a finite number, or ≤ 0.
 */
export function envInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const v = Number(env[key]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

/**
 * Parse a boolean env var.
 * When `defaultVal` is true, only '0'/'false'/'no'/'off' disable it.
 * When `defaultVal` is false, only '1'/'true'/'yes'/'on' enable it.
 */
export function envBool(env: NodeJS.ProcessEnv, key: string, defaultVal: boolean): boolean {
  const raw = String(env[key] ?? '').toLowerCase();
  if (!raw) return defaultVal;
  if (defaultVal) return !['0', 'false', 'no', 'off'].includes(raw);
  return ['1', 'true', 'yes', 'on'].includes(raw);
}
