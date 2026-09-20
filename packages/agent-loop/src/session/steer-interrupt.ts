/**
 * Running-turn interrupt policy: queue | steer | disabled.
 * Persisted on loop_settings KV. No RAW_AGENT_* switch.
 */

export type SteerInterruptPolicy = 'queue' | 'steer' | 'disabled';

export const DEFAULT_STEER_INTERRUPT_POLICY: SteerInterruptPolicy = 'queue';

/** Same key as steer-drain / daemon loop settings (avoid import cycle). */
const LOOP_SETTINGS_KV_KEY = 'loop_settings';

export function parseSteerInterruptPolicy(raw: unknown): SteerInterruptPolicy | undefined {
  if (raw === 'queue' || raw === 'steer' || raw === 'disabled') return raw;
  return undefined;
}

export function resolveSteerInterruptPolicy(input: {
  option?: unknown;
  sessionMetadata?: Record<string, unknown>;
  store?: { getDaemonControl?(key: string): unknown };
}): SteerInterruptPolicy {
  const fromOption = parseSteerInterruptPolicy(input.option);
  if (fromOption) return fromOption;
  const fromSession = parseSteerInterruptPolicy(input.sessionMetadata?.steerInterruptPolicy);
  if (fromSession) return fromSession;
  const saved = input.store?.getDaemonControl?.(LOOP_SETTINGS_KV_KEY);
  if (saved && typeof saved === 'object') {
    const fromKv = parseSteerInterruptPolicy(
      (saved as Record<string, unknown>).steerInterruptPolicy
    );
    if (fromKv) return fromKv;
  }
  return DEFAULT_STEER_INTERRUPT_POLICY;
}
