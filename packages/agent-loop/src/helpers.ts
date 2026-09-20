/**
 * L1: Pure helper functions — zero I/O, no side effects.
 */

/**
 * Parse an integer env var with a positive-value guard and floor.
 * Returns `fallback` when the value is missing, not a finite number, or ≤ 0.
 */
export function envInt(env: Record<string, string | undefined>, key: string, fallback: number): number {
  const v = Number(env[key]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

/**
 * Parse a boolean env var.
 * When `defaultVal` is true, only '0'/'false'/'no'/'off' disable it.
 * When `defaultVal` is false, only '1'/'true'/'yes'/'on' enable it.
 */
export function envBool(env: Record<string, string | undefined>, key: string, defaultVal: boolean): boolean {
  const raw = String(env[key] ?? '').toLowerCase();
  if (!raw) return defaultVal;
  if (defaultVal) return !['0', 'false', 'no', 'off'].includes(raw);
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

export function createId(prefix: string): string {
  const uuid = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${uuid.replaceAll('-', '')}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function serializeJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function parseJson<T>(value: string | null): T {
  return (value ? JSON.parse(value) : null) as T;
}

/**
 * Sync fingerprint for loop-guard (not cryptographic). Avoids `node:crypto`
 * so mini assembly can run in Chrome / other browsers.
 */
export function fingerprintHash(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + ((i + 1) & 0xffff);
    h2 = Math.imul(h2, 16777619);
  }
  return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')).slice(
    0,
    32
  );
}
