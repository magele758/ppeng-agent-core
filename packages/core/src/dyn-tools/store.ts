/**
 * dyn-tools persistence: AgentMemory (default) or session_memory bridge.
 * source = 'dyn-tool', namespace = 'dyn-tools', key = name.
 */

import { nowIso } from '../id.js';
import type { AgentMemory, MemoryScope } from '../memory/types.js';
import type { SessionMemoryEntry } from '../types.js';
import { isReservedDynToolName } from './names.js';
import {
  DEFAULT_DYN_TOOL_INPUT_SCHEMA,
  DYN_TOOLS_NAMESPACE,
  DYN_TOOL_NAME_RE,
  DYN_TOOL_SOURCE,
  DynToolError,
  MAX_ACTIVE_DRAFT_PER_SESSION,
  MAX_SOURCE_CODE_CHARS,
  type DynToolOwner,
  type DynToolRecord,
  type DynToolScope,
  type DynToolStatus
} from './types.js';

export interface DynToolBackend {
  put(record: DynToolRecord, owner: DynToolOwner): void;
  getByName(name: string, owner: DynToolOwner): DynToolRecord | undefined;
  list(owner: DynToolOwner): DynToolRecord[];
  remove(name: string, owner: DynToolOwner): boolean;
}

const SESSION_SCOPES: DynToolScope[] = ['session.scratch', 'session.long'];

export function isDynToolName(name: string): boolean {
  return DYN_TOOL_NAME_RE.test(name);
}

export function parseDynToolRecord(raw: unknown): DynToolRecord | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name : '';
  const code =
    o.source && typeof o.source === 'object' && typeof (o.source as { code?: unknown }).code === 'string'
      ? (o.source as { code: string }).code
      : typeof o.code === 'string'
        ? o.code
        : '';
  const scope = o.scope;
  if (scope !== 'session.scratch' && scope !== 'session.long' && scope !== 'project.memory') {
    return undefined;
  }
  const status = o.status;
  if (status !== 'draft' && status !== 'active' && status !== 'retired') return undefined;
  const statsRaw = o.stats && typeof o.stats === 'object' ? (o.stats as Record<string, unknown>) : {};
  const inputSchema =
    o.inputSchema && typeof o.inputSchema === 'object' && !Array.isArray(o.inputSchema)
      ? (o.inputSchema as Record<string, unknown>)
      : { ...DEFAULT_DYN_TOOL_INPUT_SCHEMA };
  return {
    name,
    description: typeof o.description === 'string' ? o.description : '',
    inputSchema,
    kind: 'ptc_cell',
    source: { code },
    scope,
    status,
    stats: {
      uses: typeof statsRaw.uses === 'number' && Number.isFinite(statsRaw.uses) ? statsRaw.uses : 0,
      lastUsedTurn:
        typeof statsRaw.lastUsedTurn === 'number' && Number.isFinite(statsRaw.lastUsedTurn)
          ? statsRaw.lastUsedTurn
          : undefined,
      lastUsedAt: typeof statsRaw.lastUsedAt === 'string' ? statsRaw.lastUsedAt : undefined
    },
    createdFrom:
      o.createdFrom && typeof o.createdFrom === 'object'
        ? (o.createdFrom as DynToolRecord['createdFrom'])
        : undefined,
    tests: Array.isArray(o.tests) ? (o.tests as DynToolRecord['tests']) : undefined,
    pin: o.pin === true,
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : nowIso(),
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : nowIso()
  };
}

function parseRecordJson(value: string): DynToolRecord | undefined {
  try {
    return parseDynToolRecord(JSON.parse(value) as unknown);
  } catch {
    return undefined;
  }
}

export class InMemoryDynToolBackend implements DynToolBackend {
  private readonly rows = new Map<string, { record: DynToolRecord; sessionId?: string }>();

  private key(scope: DynToolScope, name: string, sessionId?: string): string {
    const owner = scope === 'project.memory' ? '' : sessionId ?? '';
    return `${scope}::${owner}::${name}`;
  }

  put(record: DynToolRecord, owner: DynToolOwner): void {
    this.remove(record.name, owner);
    this.rows.set(this.key(record.scope, record.name, owner.sessionId), {
      record: { ...record },
      sessionId: record.scope === 'project.memory' ? undefined : owner.sessionId
    });
  }

  getByName(name: string, owner: DynToolOwner): DynToolRecord | undefined {
    for (const scope of SESSION_SCOPES) {
      const hit = this.rows.get(this.key(scope, name, owner.sessionId));
      if (hit) return { ...hit.record };
    }
    const project = this.rows.get(this.key('project.memory', name));
    return project ? { ...project.record } : undefined;
  }

  list(owner: DynToolOwner): DynToolRecord[] {
    const out: DynToolRecord[] = [];
    for (const row of this.rows.values()) {
      if (row.record.scope === 'project.memory') {
        out.push({ ...row.record });
        continue;
      }
      if (owner.sessionId && row.sessionId === owner.sessionId) {
        out.push({ ...row.record });
      }
    }
    return out;
  }

  remove(name: string, owner: DynToolOwner): boolean {
    let ok = false;
    for (const scope of SESSION_SCOPES) {
      ok = this.rows.delete(this.key(scope, name, owner.sessionId)) || ok;
    }
    ok = this.rows.delete(this.key('project.memory', name)) || ok;
    return ok;
  }
}

export class AgentMemoryDynToolBackend implements DynToolBackend {
  constructor(
    private readonly memory: {
      set(input: {
        scope: MemoryScope;
        namespace: string;
        key: string;
        value: string;
        sessionId?: string;
        source?: string;
        importance?: number;
        confidence?: 'low' | 'medium' | 'high';
      }): AgentMemory;
      get(opts: {
        scope: MemoryScope;
        namespace: string;
        key: string;
        sessionId?: string;
      }): AgentMemory | null;
      search(filter: {
        scope?: MemoryScope;
        namespace?: string;
        sessionId?: string;
        limit?: number;
      }): AgentMemory[];
      delete(id: string): void;
    }
  ) {}

  private readRow(row: AgentMemory): DynToolRecord | undefined {
    const parsed = parseRecordJson(row.value);
    if (!parsed) return undefined;
    if (row.scope === 'session.scratch' || row.scope === 'session.long' || row.scope === 'project.memory') {
      return { ...parsed, scope: row.scope };
    }
    return parsed;
  }

  private lookupRow(name: string, owner: DynToolOwner): AgentMemory | undefined {
    for (const scope of SESSION_SCOPES) {
      const row = this.memory.get({
        scope,
        namespace: DYN_TOOLS_NAMESPACE,
        key: name,
        sessionId: owner.sessionId
      });
      if (row) return row;
    }
    const project = this.memory.get({
      scope: 'project.memory',
      namespace: DYN_TOOLS_NAMESPACE,
      key: name
    });
    return project ?? undefined;
  }

  put(record: DynToolRecord, owner: DynToolOwner): void {
    const existing = this.lookupRow(record.name, owner);
    if (existing && (existing.scope !== record.scope || (record.scope !== 'project.memory' && existing.sessionId !== owner.sessionId))) {
      this.memory.delete(existing.id);
    }
    this.memory.set({
      scope: record.scope,
      namespace: DYN_TOOLS_NAMESPACE,
      key: record.name,
      value: JSON.stringify(record),
      sessionId: record.scope === 'project.memory' ? undefined : owner.sessionId,
      source: DYN_TOOL_SOURCE,
      importance: 0.4,
      confidence: 'medium'
    });
  }

  getByName(name: string, owner: DynToolOwner): DynToolRecord | undefined {
    const row = this.lookupRow(name, owner);
    return row ? this.readRow(row) : undefined;
  }

  list(owner: DynToolOwner): DynToolRecord[] {
    const out: DynToolRecord[] = [];
    if (owner.sessionId) {
      for (const scope of SESSION_SCOPES) {
        for (const row of this.memory.search({
          scope,
          namespace: DYN_TOOLS_NAMESPACE,
          sessionId: owner.sessionId,
          limit: 200
        })) {
          const rec = this.readRow(row);
          if (rec) out.push(rec);
        }
      }
    }
    for (const row of this.memory.search({
      scope: 'project.memory',
      namespace: DYN_TOOLS_NAMESPACE,
      limit: 200
    })) {
      const rec = this.readRow(row);
      if (rec) out.push(rec);
    }
    return out;
  }

  remove(name: string, owner: DynToolOwner): boolean {
    const row = this.lookupRow(name, owner);
    if (!row) return false;
    this.memory.delete(row.id);
    return true;
  }
}

const PROJECT_SESSION_SENTINEL = '__dyn_project__';

export class SessionMemoryDynToolBackend implements DynToolBackend {
  constructor(
    private readonly memory: {
      upsertSessionMemory(input: {
        sessionId: string;
        scope: SessionMemoryEntry['scope'];
        key: string;
        value: string;
        metadata?: Record<string, unknown>;
        source?: SessionMemoryEntry['source'];
      }): unknown;
      listSessionMemory(sessionId: string, scope?: SessionMemoryEntry['scope']): SessionMemoryEntry[];
      deleteSessionMemory(sessionId: string, scope: SessionMemoryEntry['scope'], key: string): boolean;
    }
  ) {}

  private sessionScope(scope: DynToolScope): SessionMemoryEntry['scope'] {
    return scope === 'session.scratch' ? 'scratch' : 'long';
  }

  private fromEntry(entry: SessionMemoryEntry): DynToolRecord | undefined {
    if (entry.metadata?.source !== DYN_TOOL_SOURCE && entry.metadata?.namespace !== DYN_TOOLS_NAMESPACE) {
      const parsed = parseRecordJson(entry.value);
      return parsed;
    }
    return parseRecordJson(entry.value);
  }

  put(record: DynToolRecord, owner: DynToolOwner): void {
    this.remove(record.name, owner);
    const sessionId = record.scope === 'project.memory' ? PROJECT_SESSION_SENTINEL : owner.sessionId ?? '';
    this.memory.upsertSessionMemory({
      sessionId,
      scope: this.sessionScope(record.scope),
      key: record.name,
      value: JSON.stringify(record),
      source: 'user_provided',
      metadata: {
        source: DYN_TOOL_SOURCE,
        namespace: DYN_TOOLS_NAMESPACE,
        dynToolScope: record.scope,
        pin: record.pin === true
      }
    });
  }

  getByName(name: string, owner: DynToolOwner): DynToolRecord | undefined {
    if (owner.sessionId) {
      for (const scope of ['scratch', 'long'] as const) {
        const row = this.memory
          .listSessionMemory(owner.sessionId, scope)
          .find((item) => item.key === name);
        if (row) {
          const rec = this.fromEntry(row);
          if (rec) return rec;
        }
      }
    }
    const project = this.memory
      .listSessionMemory(PROJECT_SESSION_SENTINEL, 'long')
      .find((item) => item.key === name);
    return project ? this.fromEntry(project) : undefined;
  }

  list(owner: DynToolOwner): DynToolRecord[] {
    const out: DynToolRecord[] = [];
    if (owner.sessionId) {
      for (const row of this.memory.listSessionMemory(owner.sessionId)) {
        const rec = this.fromEntry(row);
        if (rec) out.push(rec);
      }
    }
    for (const row of this.memory.listSessionMemory(PROJECT_SESSION_SENTINEL, 'long')) {
      const rec = this.fromEntry(row);
      if (rec) out.push(rec);
    }
    return out;
  }

  remove(name: string, owner: DynToolOwner): boolean {
    let ok = false;
    if (owner.sessionId) {
      ok = this.memory.deleteSessionMemory(owner.sessionId, 'scratch', name) || ok;
      ok = this.memory.deleteSessionMemory(owner.sessionId, 'long', name) || ok;
    }
    ok = this.memory.deleteSessionMemory(PROJECT_SESSION_SENTINEL, 'long', name) || ok;
    return ok;
  }
}

export interface DynToolUpsertInput {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  source: { code: string };
  scope?: DynToolScope;
  status?: DynToolStatus;
  createdFrom?: DynToolRecord['createdFrom'];
  tests?: DynToolRecord['tests'];
  pin?: boolean;
  sessionId?: string;
  reservedNames?: Iterable<string>;
}

export class DynToolStore {
  constructor(private readonly backend: DynToolBackend) {}

  upsert(input: DynToolUpsertInput): DynToolRecord {
    const name = String(input.name ?? '').trim();
    if (!isDynToolName(name)) {
      throw new DynToolError('invalid_name', `Invalid dynamic tool name: ${name || '(empty)'}`);
    }
    if (isReservedDynToolName(name, input.reservedNames ?? [])) {
      throw new DynToolError('reserved_name', `Name is reserved: ${name}`);
    }
    const code = String(input.source?.code ?? '');
    if (!code.trim()) {
      throw new DynToolError('empty_code', 'source.code is empty');
    }
    if (code.length > MAX_SOURCE_CODE_CHARS) {
      throw new DynToolError(
        'code_too_large',
        `source.code exceeds ${MAX_SOURCE_CODE_CHARS} characters`
      );
    }
    const owner: DynToolOwner = { sessionId: input.sessionId };
    const existing = this.backend.getByName(name, owner);
    const status = input.status ?? existing?.status ?? 'draft';
    const scope = input.scope ?? existing?.scope ?? 'session.scratch';
    if ((status === 'active' || status === 'draft') && !existing) {
      const quota = this.list(owner).filter(
        (row) =>
          row.scope !== 'project.memory' && (row.status === 'active' || row.status === 'draft')
      ).length;
      if (quota >= MAX_ACTIVE_DRAFT_PER_SESSION) {
        throw new DynToolError(
          'quota',
          `Session already has ${MAX_ACTIVE_DRAFT_PER_SESSION} active/draft dynamic tools`
        );
      }
    }
    const now = nowIso();
    const record: DynToolRecord = {
      name,
      description: String(input.description ?? existing?.description ?? ''),
      inputSchema: input.inputSchema ?? existing?.inputSchema ?? { ...DEFAULT_DYN_TOOL_INPUT_SCHEMA },
      kind: 'ptc_cell',
      source: { code },
      scope,
      status,
      stats: existing?.stats ?? { uses: 0 },
      createdFrom: input.createdFrom ?? existing?.createdFrom,
      tests: input.tests ?? existing?.tests,
      pin: input.pin ?? existing?.pin,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    this.backend.put(record, owner);
    return record;
  }

  get(name: string, owner: DynToolOwner): DynToolRecord | undefined {
    return this.backend.getByName(name, owner);
  }

  list(owner: DynToolOwner): DynToolRecord[] {
    return this.backend.list(owner);
  }

  listActive(sessionId: string): DynToolRecord[] {
    return this.backend.list({ sessionId }).filter((row) => row.status === 'active');
  }

  listRetiredNames(sessionId: string): Set<string> {
    return new Set(
      this.backend.list({ sessionId }).filter((row) => row.status === 'retired').map((row) => row.name)
    );
  }

  retire(name: string, sessionId: string): DynToolRecord {
    const existing = this.backend.getByName(name, { sessionId });
    if (!existing) throw new DynToolError('not_found', `Dynamic tool not found: ${name}`);
    const next: DynToolRecord = { ...existing, status: 'retired', updatedAt: nowIso() };
    this.backend.put(next, { sessionId });
    return next;
  }

  promote(name: string, sessionId: string, target: DynToolScope): DynToolRecord {
    const existing = this.backend.getByName(name, { sessionId });
    if (!existing) throw new DynToolError('not_found', `Dynamic tool not found: ${name}`);
    const next: DynToolRecord = { ...existing, scope: target, updatedAt: nowIso() };
    this.backend.put(next, { sessionId });
    return next;
  }

  recordUse(name: string, sessionId: string, turn?: number): DynToolRecord | undefined {
    const existing = this.backend.getByName(name, { sessionId });
    if (!existing) return undefined;
    const next: DynToolRecord = {
      ...existing,
      stats: {
        uses: (existing.stats.uses ?? 0) + 1,
        lastUsedTurn: turn ?? existing.stats.lastUsedTurn,
        lastUsedAt: nowIso()
      },
      updatedAt: nowIso()
    };
    this.backend.put(next, { sessionId });
    return next;
  }
}

export function createDynToolStore(backend?: DynToolBackend): DynToolStore {
  return new DynToolStore(backend ?? new InMemoryDynToolBackend());
}

export function createDynToolStoreFromAgentMemory(memory: ConstructorParameters<typeof AgentMemoryDynToolBackend>[0]): DynToolStore {
  return new DynToolStore(new AgentMemoryDynToolBackend(memory));
}

export function createDynToolStoreFromSessionMemory(
  memory: ConstructorParameters<typeof SessionMemoryDynToolBackend>[0]
): DynToolStore {
  return new DynToolStore(new SessionMemoryDynToolBackend(memory));
}

export function tryCreateDynToolStore(store: {
  agentMemory?(): ConstructorParameters<typeof AgentMemoryDynToolBackend>[0];
  upsertSessionMemory?(input: {
    sessionId: string;
    scope: SessionMemoryEntry['scope'];
    key: string;
    value: string;
    metadata?: Record<string, unknown>;
    source?: SessionMemoryEntry['source'];
  }): unknown;
  listSessionMemory?(sessionId: string, scope?: SessionMemoryEntry['scope']): SessionMemoryEntry[];
  deleteSessionMemory?(sessionId: string, scope: SessionMemoryEntry['scope'], key: string): boolean;
}): DynToolStore | undefined {
  if (typeof store.agentMemory === 'function') {
    try {
      return createDynToolStoreFromAgentMemory(store.agentMemory());
    } catch {
      /* fall through */
    }
  }
  if (
    typeof store.upsertSessionMemory === 'function' &&
    typeof store.listSessionMemory === 'function' &&
    typeof store.deleteSessionMemory === 'function'
  ) {
    return createDynToolStoreFromSessionMemory({
      upsertSessionMemory: store.upsertSessionMemory,
      listSessionMemory: store.listSessionMemory,
      deleteSessionMemory: store.deleteSessionMemory
    });
  }
  return undefined;
}

export function isDynToolMemoryEntry(entry: {
  namespace?: string;
  source?: string;
  metadata?: Record<string, unknown> | null;
  key?: string;
}): boolean {
  if (entry.namespace === DYN_TOOLS_NAMESPACE) return true;
  if (entry.source === DYN_TOOL_SOURCE) return true;
  if (entry.metadata?.source === DYN_TOOL_SOURCE || entry.metadata?.namespace === DYN_TOOLS_NAMESPACE) {
    return true;
  }
  return false;
}

export function isDynToolAppendixEligible(entry: {
  namespace?: string;
  source?: string;
  metadata?: Record<string, unknown> | null;
  value?: string;
  key?: string;
}): boolean {
  if (!isDynToolMemoryEntry(entry)) return true;
  if (entry.metadata?.pin === true) return true;
  if (typeof entry.value === 'string') {
    const rec = parseRecordJson(entry.value);
    if (rec?.pin === true) return true;
  }
  return false;
}
