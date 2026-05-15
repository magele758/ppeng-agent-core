/** Snapshot of persisted buffer metadata (PG SoT; optional Redis cache). */
export type EventBufferMeta = {
  tenantId: string;
  userId: string;
  sessionId: string;
  status?: string | null;
  taskContent?: string | null;
  sequence: number;
  agentId?: string | null;
  savedAt: number;
};

export type EventBufferEventRow = {
  tenantId: string;
  userId: string;
  sessionId: string;
  seq: number;
  eventType: string;
  payload: unknown;
};

export type EventBufferAppendInput = {
  tenantId: string;
  userId: string;
  sessionId: string;
  eventType: string;
  payload: unknown;
  /** When set, also updates meta row fields (optional). */
  metaPatch?: Partial<
    Pick<EventBufferMeta, 'status' | 'taskContent' | 'agentId'>
  >;
};

/**
 * Cross-pod session event / trace buffer. PG is source of truth; Redis holds optional meta TTL cache.
 * Local/dev mode keeps using JSONL on disk only (see `appendTraceEvent`).
 */
export interface EventBufferRepository {
  appendEvent(input: EventBufferAppendInput): Promise<void>;
  listEvents(params: { tenantId: string; userId: string; sessionId: string }): Promise<EventBufferEventRow[]>;
  getMeta(params: { tenantId: string; userId: string; sessionId: string }): Promise<EventBufferMeta | null>;
}

/** Tier descriptor for hot (L2) + cold (L3) assets. */
export type TieredAssetDescriptor = {
  key: string;
  /** Logical tenant / isolation prefix for Redis LRU coordination. */
  tenantId: string;
  sha256?: string;
  sizeBytes?: number;
};

/** Facade for workspace/skill binaries: L2 emptyDir/PVC path, L3 S3-compatible object store. */
export interface AssetStorage {
  read(desc: TieredAssetDescriptor): Promise<Buffer | null>;
  write(desc: TieredAssetDescriptor, body: Buffer): Promise<void>;
  /** Best-effort: touch LRU ordering in Redis; evict local files when over quota. */
  touchAccess(desc: TieredAssetDescriptor): Promise<void>;
}

export type SkillCatalogRow = {
  id: string;
  version: string;
  sha256: string;
  sizeBytes: number;
  downloadUrl: string | null;
  meta: Record<string, unknown>;
};

/** Cloud catalog reader; maps rows into runtime `SkillSpec` in `pg-skill-registry-client`. */
export interface SkillRegistryClient {
  listCatalogRows(): Promise<SkillCatalogRow[]>;
}
