/**
 * Shared helpers for storage domain stores.
 *
 * These small utilities are used by SqliteStateStore and all extracted
 * domain stores.  Centralising them avoids duplication that previously
 * existed in session-memory-store.ts.
 */

export function serializeJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function parseJson<T>(value: string | null): T {
  return (value ? JSON.parse(value) : null) as T;
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

export function intToBool(value: unknown): boolean {
  return Number(value) === 1;
}
