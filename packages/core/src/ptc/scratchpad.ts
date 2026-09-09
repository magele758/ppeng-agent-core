import {
  PTC_KEY_PREFIX,
  PTC_LAST_RETURN_KEY,
  decodePtcStoredValue,
  ptcBareKey,
  ptcStoredKey,
  type PtcScratchVisibility,
  type PtcStoredMeta
} from '../memory/ptc-meta.js';
import type { SessionMemoryEntry } from '../types.js';

export const PTC_SCRATCH_MAX_KEYS = 40;
export const PTC_SCRATCH_MAX_VALUE_CHARS = 8192;
export const PTC_RESULT_MAX_CHARS = 8192;

export { PTC_KEY_PREFIX, PTC_LAST_RETURN_KEY };
export type { PtcScratchVisibility };

export class PtcScratchpadError extends Error {
  readonly code: 'reserved' | 'too_large' | 'quota' | 'not_found' | 'invalid';

  constructor(message: string, code: PtcScratchpadError['code']) {
    super(message);
    this.name = 'PtcScratchpadError';
    this.code = code;
  }
}

export interface PtcScratchWriteSpec {
  key: string;
  value: string;
  visibility: PtcScratchVisibility;
  pin: boolean;
  ttlSec?: number;
  expiresAt?: string;
}

export interface PtcScratchRecord {
  key: string;
  value: string;
  visibility: PtcScratchVisibility;
  pin: boolean;
  expiresAt?: string;
  updatedAt: string;
}

export interface PtcScratchPersist {
  write(record: PtcScratchRecord): Promise<void>;
  read(key: string): Promise<PtcScratchRecord | null>;
  list(): Promise<Array<Pick<PtcScratchRecord, 'key' | 'updatedAt'> & Partial<PtcScratchRecord>>>;
  delete(key: string): Promise<void>;
  count(): Promise<number>;
}

export interface SessionMemoryLike {
  upsertSessionMemory(input: {
    sessionId: string;
    scope: SessionMemoryEntry['scope'];
    key: string;
    value: string;
    metadata?: Record<string, unknown>;
    source?: SessionMemoryEntry['source'];
  }): SessionMemoryEntry | void;
  listSessionMemory(sessionId: string, scope?: SessionMemoryEntry['scope']): SessionMemoryEntry[];
  deleteSessionMemory(sessionId: string, scope: SessionMemoryEntry['scope'], key: string): boolean;
}

function stringifyScratchValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, (_k, item) => {
      if (typeof item === 'bigint') return item.toString();
      if (typeof item === 'function' || typeof item === 'symbol') return String(item);
      return item;
    }) ?? 'null';
  } catch {
    return String(value);
  }
}

export function parseScratchpadWrite(raw: unknown, content?: unknown): PtcScratchWriteSpec {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && content === undefined) {
    const obj = raw as Record<string, unknown>;
    const key = typeof obj.key === 'string' ? obj.key.trim() : '';
    if (!key) throw new PtcScratchpadError('scratchpad.write requires key', 'invalid');
    const valueSource = obj.value !== undefined ? obj.value : obj.content;
    const visibility = parseVisibility(obj.visibility);
    const pin = obj.pin === true;
    const ttlSec = typeof obj.ttlSec === 'number' && Number.isFinite(obj.ttlSec) ? obj.ttlSec : undefined;
    return {
      key,
      value: stringifyScratchValue(valueSource),
      visibility,
      pin,
      ttlSec
    };
  }
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new PtcScratchpadError('scratchpad.write requires key', 'invalid');
  }
  return {
    key: raw.trim(),
    value: stringifyScratchValue(content),
    visibility: 'session',
    pin: false
  };
}

function parseVisibility(raw: unknown): PtcScratchVisibility {
  if (raw === 'cell' || raw === 'session' || raw === 'inherit') return raw;
  return 'session';
}

function isExpired(expiresAt: string | undefined, nowMs: number): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && t <= nowMs;
}

export class PtcScratchpadSession {
  private readonly cell = new Map<string, PtcScratchRecord>();

  constructor(
    private readonly persist?: PtcScratchPersist,
    private readonly nowMs: () => number = () => Date.now()
  ) {}

  async write(
    raw: unknown,
    content?: unknown,
    opts?: { allowReserved?: boolean }
  ): Promise<{ ok: true; key: string; bytes: number; visibility: PtcScratchVisibility }> {
    const spec = parseScratchpadWrite(raw, content);
    return this.commitWrite(spec, opts);
  }

  async writeReserved(
    key: string,
    value: string
  ): Promise<{ ok: true; key: string; bytes: number; visibility: PtcScratchVisibility }> {
    return this.commitWrite(
      { key, value, visibility: 'session', pin: false },
      { allowReserved: true }
    );
  }

  async read(rawKey: unknown): Promise<{ ok: true; key: string; content: string }> {
    const key = typeof rawKey === 'string' ? rawKey.trim() : '';
    if (!key) throw new PtcScratchpadError('scratchpad.read requires key', 'invalid');
    const row = await this.lookup(key);
    if (!row) throw new PtcScratchpadError(`scratchpad key not found: ${key}`, 'not_found');
    return { ok: true, key, content: row.value };
  }

  async list(): Promise<{ ok: true; entries: Array<{ key: string; updatedAt: string }> }> {
    const now = this.nowMs();
    const seen = new Set<string>();
    const entries: Array<{ key: string; updatedAt: string }> = [];
    for (const row of this.cell.values()) {
      if (isExpired(row.expiresAt, now)) {
        this.cell.delete(row.key);
        continue;
      }
      seen.add(row.key);
      entries.push({ key: row.key, updatedAt: row.updatedAt });
    }
    if (this.persist) {
      for (const row of await this.persist.list()) {
        if (seen.has(row.key)) continue;
        if (isExpired(row.expiresAt, now)) {
          await this.persist.delete(row.key);
          continue;
        }
        entries.push({ key: row.key, updatedAt: row.updatedAt ?? new Date(now).toISOString() });
      }
    }
    entries.sort((a, b) => a.key.localeCompare(b.key));
    return { ok: true, entries };
  }

  async delete(rawKey: unknown): Promise<{ ok: true; key: string }> {
    const key = typeof rawKey === 'string' ? rawKey.trim() : '';
    if (!key) throw new PtcScratchpadError('scratchpad.delete requires key', 'invalid');
    this.cell.delete(key);
    if (this.persist) await this.persist.delete(key);
    return { ok: true, key };
  }

  dispose(): void {
    this.cell.clear();
  }

  private async commitWrite(
    spec: PtcScratchWriteSpec,
    opts?: { allowReserved?: boolean }
  ): Promise<{ ok: true; key: string; bytes: number; visibility: PtcScratchVisibility }> {
    const reservedBypass = spec.key === PTC_LAST_RETURN_KEY && opts?.allowReserved === true;
    if (spec.key === PTC_LAST_RETURN_KEY && !reservedBypass) {
      throw new PtcScratchpadError('scratchpad key __last_return is reserved', 'reserved');
    }
    if (!reservedBypass && spec.value.length > PTC_SCRATCH_MAX_VALUE_CHARS) {
      throw new PtcScratchpadError(
        `scratchpad value exceeds ${PTC_SCRATCH_MAX_VALUE_CHARS} characters`,
        'too_large'
      );
    }
    const now = this.nowMs();
    const expiresAt =
      spec.expiresAt ??
      (spec.ttlSec != null ? new Date(now + spec.ttlSec * 1000).toISOString() : undefined);
    const record: PtcScratchRecord = {
      key: spec.key,
      value: spec.value,
      visibility: spec.visibility,
      pin: spec.pin,
      expiresAt,
      updatedAt: new Date(now).toISOString()
    };
    if (spec.visibility === 'cell') {
      this.cell.set(spec.key, record);
      return {
        ok: true,
        key: spec.key,
        bytes: Buffer.byteLength(spec.value, 'utf8'),
        visibility: spec.visibility
      };
    }
    if (this.persist) {
      if (!reservedBypass) {
        const existing = await this.persist.read(spec.key);
        const count = await this.persist.count();
        if (!existing && count >= PTC_SCRATCH_MAX_KEYS) {
          throw new PtcScratchpadError(
            `scratchpad session quota exceeded (${PTC_SCRATCH_MAX_KEYS})`,
            'quota'
          );
        }
      }
      await this.persist.write(record);
    } else {
      const persisted = [...this.cell.values()].filter((row) => row.visibility !== 'cell');
      const replacing = this.cell.has(spec.key) && this.cell.get(spec.key)!.visibility !== 'cell';
      if (!replacing && persisted.length >= PTC_SCRATCH_MAX_KEYS) {
        throw new PtcScratchpadError(
          `scratchpad session quota exceeded (${PTC_SCRATCH_MAX_KEYS})`,
          'quota'
        );
      }
    }
    this.cell.set(spec.key, record);
    return {
      ok: true,
      key: spec.key,
      bytes: Buffer.byteLength(spec.value, 'utf8'),
      visibility: spec.visibility
    };
  }

  private async lookup(key: string): Promise<PtcScratchRecord | null> {
    const now = this.nowMs();
    const local = this.cell.get(key);
    if (local) {
      if (isExpired(local.expiresAt, now)) {
        this.cell.delete(key);
        if (this.persist && local.visibility !== 'cell') await this.persist.delete(key);
        return null;
      }
      return local;
    }
    if (!this.persist) return null;
    const row = await this.persist.read(key);
    if (!row) return null;
    if (isExpired(row.expiresAt, now)) {
      await this.persist.delete(key);
      return null;
    }
    return row;
  }
}

export function createStoreScratchPersist(
  store: SessionMemoryLike,
  sessionId: string
): PtcScratchPersist {
  const toRecord = (row: SessionMemoryEntry): PtcScratchRecord => {
    const decoded = decodePtcStoredValue(row.value);
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const visibility = parseVisibility(meta.visibility ?? decoded.meta?.visibility);
    const pin = meta.pin === true || decoded.meta?.pin === true;
    const expiresAt =
      (typeof meta.expiresAt === 'string' ? meta.expiresAt : undefined) ?? decoded.meta?.expiresAt;
    return {
      key: ptcBareKey(row.key),
      value: decoded.value,
      visibility,
      pin,
      expiresAt,
      updatedAt: row.updatedAt
    };
  };

  return {
    async write(record) {
      const meta: PtcStoredMeta = {
        visibility: record.visibility,
        pin: record.pin,
        expiresAt: record.expiresAt
      };
      store.upsertSessionMemory({
        sessionId,
        scope: 'scratch',
        key: ptcStoredKey(record.key),
        value: record.value,
        source: 'ptc',
        metadata: { source: 'ptc', ...meta }
      });
    },
    async read(key) {
      const wanted = ptcStoredKey(key);
      const row = store.listSessionMemory(sessionId, 'scratch').find((item) => item.key === wanted);
      if (!row) return null;
      const record = toRecord(row);
      if (isExpired(record.expiresAt, Date.now())) {
        store.deleteSessionMemory(sessionId, 'scratch', wanted);
        return null;
      }
      return record;
    },
    async list() {
      const now = Date.now();
      const records: PtcScratchRecord[] = [];
      for (const item of store.listSessionMemory(sessionId, 'scratch')) {
        if (!item.key.startsWith(PTC_KEY_PREFIX)) continue;
        const record = toRecord(item);
        if (isExpired(record.expiresAt, now)) {
          store.deleteSessionMemory(sessionId, 'scratch', item.key);
          continue;
        }
        records.push(record);
      }
      return records;
    },
    async delete(key) {
      store.deleteSessionMemory(sessionId, 'scratch', ptcStoredKey(key));
    },
    async count() {
      const now = Date.now();
      let n = 0;
      for (const item of store.listSessionMemory(sessionId, 'scratch')) {
        if (!item.key.startsWith(PTC_KEY_PREFIX)) continue;
        const record = toRecord(item);
        if (isExpired(record.expiresAt, now)) {
          store.deleteSessionMemory(sessionId, 'scratch', item.key);
          continue;
        }
        n += 1;
      }
      return n;
    }
  };
}

export function createMemoryScratchPersist(): PtcScratchPersist {
  const rows = new Map<string, PtcScratchRecord>();
  return {
    async write(record) {
      rows.set(record.key, { ...record });
    },
    async read(key) {
      return rows.get(key) ?? null;
    },
    async list() {
      return [...rows.values()];
    },
    async delete(key) {
      rows.delete(key);
    },
    async count() {
      return rows.size;
    }
  };
}

