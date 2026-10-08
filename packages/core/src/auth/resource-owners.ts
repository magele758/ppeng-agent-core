import type { DatabaseSync } from 'node:sqlite';
import { nowIso } from '../id.js';
import type { RequestAuth } from './types.js';

/**
 * Owner registry for resources whose own rows carry no user column
 * (swarm runs, research tasks, orchestration runs, team plans, cloud folders).
 * A resource absent from the registry is "unowned": created in single-user mode
 * or by an operator, and only visible to admins once Lab login isolates users.
 */
export class ResourceOwnerStore {
  constructor(private readonly db: DatabaseSync) {}

  claim(kind: string, resourceId: string, auth: RequestAuth): void {
    if (!auth.user) return;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO resource_owners (kind, resource_id, user_id, tenant_id, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(kind, resourceId, auth.user.id, auth.user.tenantId ?? null, nowIso());
  }

  ownerOf(kind: string, resourceId: string): string | undefined {
    const row = this.db
      .prepare(`SELECT user_id FROM resource_owners WHERE kind = ? AND resource_id = ?`)
      .get(kind, resourceId) as { user_id?: unknown } | undefined;
    return typeof row?.user_id === 'string' ? row.user_id : undefined;
  }

  release(kind: string, resourceId: string): void {
    this.db.prepare(`DELETE FROM resource_owners WHERE kind = ? AND resource_id = ?`).run(kind, resourceId);
  }
}

/**
 * Whether an isolated caller may see a resource with the given owner:
 * its own rows always, unowned rows only as an admin, other users' rows never.
 */
export function ownerVisibleTo(ownerId: string | undefined, auth: RequestAuth): boolean {
  if (!auth.isolate) return true;
  if (!auth.user) return false;
  if (ownerId === undefined) return auth.admin === true;
  return ownerId === auth.user.id;
}

/** Keeps only the registry-owned rows the caller may see (see {@link ownerVisibleTo}). */
export function filterOwnedResources<T>(
  owners: ResourceOwnerStore,
  kind: string,
  rows: readonly T[],
  idOf: (row: T) => string,
  auth: RequestAuth
): T[] {
  if (!auth.isolate) return [...rows];
  return rows.filter((row) => ownerVisibleTo(owners.ownerOf(kind, idOf(row)), auth));
}
