/**
 * SQLite CapabilityStore for Capability Registry.
 */

import type { DatabaseSync } from 'node:sqlite';
import { NotFoundError } from '../errors.js';
import { createId, nowIso } from '../id.js';
import { optionalString, parseJson, serializeJson } from '../stores/storage-helpers.js';
import type {
  CapabilityBinding,
  CapabilityCard,
  CapabilityCbom,
  CapabilityKind,
  CapabilityTransport,
  CapabilityTrust,
  CreateBindingInput,
  CreateCapabilityInput,
  ListCapabilitiesFilter,
  UpdateCapabilityInput
} from './types.js';

function mapCard(row: Record<string, unknown>): CapabilityCard {
  return {
    id: String(row.id),
    kind: String(row.kind) as CapabilityKind,
    name: String(row.name),
    description: optionalString(row.description),
    endpoint: String(row.endpoint),
    transport: String(row.transport) as CapabilityTransport,
    schemaRef: optionalString(row.schema_ref),
    schemaHash: optionalString(row.schema_hash),
    trust: String(row.trust) as CapabilityTrust,
    scope: parseJson<string[]>(String(row.scope ?? '[]')) ?? [],
    credRef: optionalString(row.cred_ref),
    source: String(row.source ?? 'manual'),
    cbom: row.cbom_json ? parseJson<CapabilityCbom>(String(row.cbom_json)) ?? undefined : undefined,
    pool: optionalString(row.pool),
    tags: row.tags_json ? parseJson<string[]>(String(row.tags_json)) ?? undefined : undefined,
    metadata: row.metadata_json
      ? parseJson<Record<string, unknown>>(String(row.metadata_json)) ?? undefined
      : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapBinding(row: Record<string, unknown>): CapabilityBinding {
  return {
    id: String(row.id),
    capabilityId: String(row.capability_id),
    toolName: String(row.tool_name),
    schemaHashPin: String(row.schema_hash_pin),
    status: String(row.status) as CapabilityBinding['status'],
    boundAt: String(row.bound_at),
    updatedAt: String(row.updated_at),
    metadata: row.metadata_json
      ? parseJson<Record<string, unknown>>(String(row.metadata_json)) ?? undefined
      : undefined
  };
}

export class CapabilityStore {
  constructor(private readonly db: DatabaseSync) {}

  create(input: CreateCapabilityInput): CapabilityCard {
    const id = createId('cap');
    const now = nowIso();
    const trust = input.trust ?? 'untrusted';
    this.db
      .prepare(
        `INSERT INTO capabilities (
          id, kind, name, description, endpoint, transport, schema_ref, schema_hash,
          trust, scope, cred_ref, source, cbom_json, pool, tags_json, metadata_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.kind,
        input.name,
        input.description ?? null,
        input.endpoint,
        input.transport ?? 'https',
        input.schemaRef ?? null,
        input.schemaHash ?? null,
        trust,
        serializeJson(input.scope ?? []),
        input.credRef ?? null,
        input.source ?? 'manual',
        input.cbom ? serializeJson(input.cbom) : null,
        input.pool ?? null,
        input.tags ? serializeJson(input.tags) : null,
        input.metadata ? serializeJson(input.metadata) : null,
        now,
        now
      );
    return this.get(id)!;
  }

  get(id: string): CapabilityCard | undefined {
    const row = this.db.prepare(`SELECT * FROM capabilities WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapCard(row) : undefined;
  }

  list(filter: ListCapabilitiesFilter = {}): CapabilityCard[] {
    const clauses: string[] = [];
    const values: (string | number)[] = [];
    if (filter.trust) {
      clauses.push('trust = ?');
      values.push(filter.trust);
    }
    if (filter.kind) {
      clauses.push('kind = ?');
      values.push(filter.kind);
    }
    if (filter.pool) {
      clauses.push('pool = ?');
      values.push(filter.pool);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Number.isFinite(filter.limit) && (filter.limit as number) > 0 ? filter.limit! : 200;
    const offset =
      Number.isFinite(filter.offset) && (filter.offset as number) >= 0 ? filter.offset! : 0;
    values.push(limit, offset);
    const rows = this.db
      .prepare(
        `SELECT * FROM capabilities ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`
      )
      .all(...values) as Record<string, unknown>[];
    return rows.map(mapCard);
  }

  update(id: string, input: UpdateCapabilityInput): CapabilityCard {
    const cur = this.get(id);
    if (!cur) throw new NotFoundError('Capability', id);
    const now = nowIso();
    const next = {
      name: input.name ?? cur.name,
      description: input.description !== undefined ? input.description : cur.description,
      endpoint: input.endpoint ?? cur.endpoint,
      transport: input.transport ?? cur.transport,
      schemaRef: input.schemaRef !== undefined ? input.schemaRef : cur.schemaRef,
      schemaHash: input.schemaHash !== undefined ? input.schemaHash : cur.schemaHash,
      scope: input.scope ?? cur.scope,
      credRef: input.credRef !== undefined ? input.credRef : cur.credRef,
      source: input.source ?? cur.source,
      cbom: input.cbom !== undefined ? input.cbom : cur.cbom,
      pool: input.pool !== undefined ? input.pool : cur.pool,
      tags: input.tags !== undefined ? input.tags : cur.tags,
      metadata: input.metadata !== undefined ? input.metadata : cur.metadata
    };
    this.db
      .prepare(
        `UPDATE capabilities SET
          name = ?, description = ?, endpoint = ?, transport = ?, schema_ref = ?, schema_hash = ?,
          scope = ?, cred_ref = ?, source = ?, cbom_json = ?, pool = ?, tags_json = ?, metadata_json = ?,
          updated_at = ?
        WHERE id = ?`
      )
      .run(
        next.name,
        next.description ?? null,
        next.endpoint,
        next.transport,
        next.schemaRef ?? null,
        next.schemaHash ?? null,
        serializeJson(next.scope),
        next.credRef ?? null,
        next.source,
        next.cbom ? serializeJson(next.cbom) : null,
        next.pool ?? null,
        next.tags ? serializeJson(next.tags) : null,
        next.metadata ? serializeJson(next.metadata) : null,
        now,
        id
      );
    return this.get(id)!;
  }

  setTrust(id: string, trust: CapabilityTrust): CapabilityCard {
    const cur = this.get(id);
    if (!cur) throw new NotFoundError('Capability', id);
    this.db
      .prepare(`UPDATE capabilities SET trust = ?, updated_at = ? WHERE id = ?`)
      .run(trust, nowIso(), id);
    return this.get(id)!;
  }

  createBinding(input: CreateBindingInput): CapabilityBinding {
    const id = createId('capb');
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO capability_bindings (
          id, capability_id, tool_name, schema_hash_pin, status, bound_at, updated_at, metadata_json
        ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`
      )
      .run(
        id,
        input.capabilityId,
        input.toolName,
        input.schemaHashPin,
        now,
        now,
        input.metadata ? serializeJson(input.metadata) : null
      );
    return this.getBinding(id)!;
  }

  getBinding(id: string): CapabilityBinding | undefined {
    const row = this.db.prepare(`SELECT * FROM capability_bindings WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapBinding(row) : undefined;
  }

  listBindings(capabilityId: string): CapabilityBinding[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM capability_bindings WHERE capability_id = ? ORDER BY bound_at ASC`
      )
      .all(capabilityId) as Record<string, unknown>[];
    return rows.map(mapBinding);
  }

  setBindingStatus(id: string, status: CapabilityBinding['status']): CapabilityBinding {
    const cur = this.getBinding(id);
    if (!cur) throw new NotFoundError('CapabilityBinding', id);
    this.db
      .prepare(`UPDATE capability_bindings SET status = ?, updated_at = ? WHERE id = ?`)
      .run(status, nowIso(), id);
    return this.getBinding(id)!;
  }
}
