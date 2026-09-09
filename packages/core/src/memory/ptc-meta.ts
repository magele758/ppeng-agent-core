/** PTC scratch metadata helpers. Kept in memory/ so recall can filter without importing ptc/. */

export const PTC_KEY_PREFIX = 'ptc.';
export const PTC_VALUE_META_PREFIX = '\x1eptc-meta:';
export const PTC_LAST_RETURN_KEY = '__last_return';

export type PtcScratchVisibility = 'cell' | 'session' | 'inherit';

export interface PtcStoredMeta {
  visibility: PtcScratchVisibility;
  pin: boolean;
  expiresAt?: string;
}

export function isPtcScratchKey(key: string): boolean {
  return key.startsWith(PTC_KEY_PREFIX);
}

export function ptcBareKey(storedKey: string): string {
  return isPtcScratchKey(storedKey) ? storedKey.slice(PTC_KEY_PREFIX.length) : storedKey;
}

export function ptcStoredKey(bareKey: string): string {
  return isPtcScratchKey(bareKey) ? bareKey : `${PTC_KEY_PREFIX}${bareKey}`;
}

export function encodePtcStoredValue(value: string, meta: PtcStoredMeta): string {
  return `${PTC_VALUE_META_PREFIX}${JSON.stringify(meta)}\n${value}`;
}

export function encodePersistedPtcValue(value: string, metadata?: Record<string, unknown>): string {
  if (!metadata || (metadata.visibility == null && metadata.pin == null && metadata.expiresAt == null)) {
    return value;
  }
  const visibility =
    metadata.visibility === 'cell' || metadata.visibility === 'session' || metadata.visibility === 'inherit'
      ? metadata.visibility
      : 'session';
  return encodePtcStoredValue(value, {
    visibility,
    pin: metadata.pin === true,
    expiresAt: typeof metadata.expiresAt === 'string' ? metadata.expiresAt : undefined
  });
}

export function decodePtcStoredValue(raw: string): { value: string; meta?: PtcStoredMeta } {
  if (typeof raw !== 'string' || !raw.startsWith(PTC_VALUE_META_PREFIX)) {
    return { value: raw };
  }
  const nl = raw.indexOf('\n');
  if (nl < 0) return { value: raw };
  try {
    const parsed = JSON.parse(raw.slice(PTC_VALUE_META_PREFIX.length, nl)) as PtcStoredMeta;
    if (!parsed || typeof parsed !== 'object') return { value: raw };
    return { value: raw.slice(nl + 1), meta: parsed };
  } catch {
    return { value: raw };
  }
}

function readExpiresAt(entry: {
  metadata?: Record<string, unknown> | null;
  value?: string;
  expiresAt?: string;
}): string | undefined {
  if (typeof entry.expiresAt === 'string') return entry.expiresAt;
  if (typeof entry.metadata?.expiresAt === 'string') return entry.metadata.expiresAt;
  if (typeof entry.value === 'string') return decodePtcStoredValue(entry.value).meta?.expiresAt;
  return undefined;
}

export function isPtcValueExpired(entry: {
  metadata?: Record<string, unknown> | null;
  value?: string;
  expiresAt?: string;
}, nowMs = Date.now()): boolean {
  const expiresAt = readExpiresAt(entry);
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && t <= nowMs;
}

export function isPtcAppendixEligible(entry: {
  key?: string;
  metadata?: Record<string, unknown> | null;
  value?: string;
  expiresAt?: string;
}): boolean {
  if (isPtcValueExpired(entry)) return false;
  const key = String(entry.key ?? '');
  if (!isPtcScratchKey(key)) return true;
  if (entry.metadata && entry.metadata.pin === true) return true;
  if (typeof entry.value === 'string') {
    const { meta } = decodePtcStoredValue(entry.value);
    if (meta?.pin === true) return true;
  }
  return false;
}

export function scratchKeyFilterFromInherit(
  inherit: boolean | string[] | undefined
): (key: string) => boolean {
  return (key: string) => {
    if (!isPtcScratchKey(key)) return true;
    if (inherit === true) return true;
    if (Array.isArray(inherit)) {
      const bare = ptcBareKey(key);
      return inherit.some((item) => {
        const token = String(item).trim();
        return token === bare || token === key || token === ptcStoredKey(bare);
      });
    }
    return false;
  };
}
