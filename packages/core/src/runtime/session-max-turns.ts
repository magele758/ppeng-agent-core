/**
 * Session turn cap. Only 24 / 48 / 96 are legal. Missing metadata keeps the
 * caller's global default (RAW_AGENT_MAX_TURNS, normally 24).
 */

import { ValidationError } from '../errors.js';

export const SESSION_MAX_TURNS_CHOICES = [24, 48, 96] as const;
export type SessionMaxTurns = (typeof SESSION_MAX_TURNS_CHOICES)[number];

export function isSessionMaxTurns(value: unknown): value is SessionMaxTurns {
  return value === 24 || value === 48 || value === 96;
}

/** Reject anything other than 24, 48, or 96. Numeric strings of those values are accepted. */
export function parseSessionMaxTurns(raw: unknown): SessionMaxTurns {
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw.trim())
        : Number.NaN;
  if (isSessionMaxTurns(n)) return n;
  throw new ValidationError('maxTurns must be 24, 48, or 96');
}

/**
 * Turn cap the kernel should run. Missing or illegal stored values use
 * `fallback` (the global max): writes are validated at the API boundary, and a
 * bad value that slipped in must not make the session unrunnable.
 */
export function resolveSessionMaxTurns(
  metadata: Record<string, unknown> | undefined,
  fallback: number
): number {
  if (!metadata || !Object.prototype.hasOwnProperty.call(metadata, 'maxTurns')) {
    return fallback;
  }
  try {
    return parseSessionMaxTurns(metadata.maxTurns);
  } catch {
    return fallback;
  }
}
