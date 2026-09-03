import type { DatabaseSync } from 'node:sqlite';
import { createId, nowIso } from '../id.js';
import { boolToInt, intToBool } from '../stores/storage-helpers.js';
import { uniqueAlias } from './resolve.js';
import type { ProjectRecord, ProjectRootRecord } from './types.js';

function mapRoot(row: Record<string, unknown>): ProjectRootRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    alias: String(row.alias),
    path: String(row.path),
    isPrimary: intToBool(row.is_primary)
  };
}

export class ProjectStore {
  constructor(private readonly db: DatabaseSync) {}

  list(): ProjectRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM projects ORDER BY updated_at DESC`)
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.hydrate(row));
  }

  get(id: string): ProjectRecord | undefined {
    const row = this.db
      .prepare(`SELECT * FROM projects WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.hydrate(row) : undefined;
  }

  create(input: { name: string; roots?: Array<{ alias?: string; path: string; primary?: boolean }> }): ProjectRecord {
    const now = nowIso();
    const id = createId('proj');
    const name = input.name.trim() || 'Untitled project';
    this.db
      .prepare(`INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(id, name, now, now);
    const roots = input.roots ?? [];
    const taken: string[] = [];
    for (let i = 0; i < roots.length; i += 1) {
      const spec = roots[i]!;
      const alias = uniqueAlias(spec.alias ?? spec.path.split(/[\\/]/).filter(Boolean).at(-1) ?? 'root', taken);
      taken.push(alias);
      const isPrimary = spec.primary === true || (i === 0 && !roots.some((r) => r.primary));
      this.insertRoot(id, alias, spec.path, isPrimary);
    }
    this.ensureOnePrimary(id);
    return this.get(id)!;
  }

  update(id: string, patch: { name?: string; primaryRootId?: string }): ProjectRecord | undefined {
    const cur = this.get(id);
    if (!cur) return undefined;
    if (typeof patch.name === 'string' && patch.name.trim()) {
      this.db
        .prepare(`UPDATE projects SET name = ?, updated_at = ? WHERE id = ?`)
        .run(patch.name.trim(), nowIso(), id);
    }
    if (typeof patch.primaryRootId === 'string' && patch.primaryRootId.trim()) {
      this.setPrimary(id, patch.primaryRootId.trim());
    }
    this.touch(id);
    return this.get(id);
  }

  remove(id: string): boolean {
    this.db.prepare(`DELETE FROM project_roots WHERE project_id = ?`).run(id);
    const res = this.db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
    return Number(res.changes) > 0;
  }

  addRoot(
    projectId: string,
    input: { path: string; alias?: string; primary?: boolean }
  ): ProjectRootRecord | undefined {
    const project = this.get(projectId);
    if (!project) return undefined;
    const alias = uniqueAlias(
      input.alias ?? input.path.split(/[\\/]/).filter(Boolean).at(-1) ?? 'root',
      project.roots.map((r) => r.alias)
    );
    const makePrimary = input.primary === true || project.roots.length === 0;
    const root = this.insertRoot(projectId, alias, input.path, makePrimary);
    if (makePrimary) this.setPrimary(projectId, root.id);
    this.touch(projectId);
    return this.getRoot(root.id);
  }

  removeRoot(projectId: string, rootId: string): boolean {
    const project = this.get(projectId);
    if (!project) return false;
    if (project.roots.length <= 1) return false;
    const target = project.roots.find((r) => r.id === rootId);
    if (!target) return false;
    this.db.prepare(`DELETE FROM project_roots WHERE id = ? AND project_id = ?`).run(rootId, projectId);
    if (target.isPrimary) {
      const next = this.listRoots(projectId)[0];
      if (next) this.setPrimary(projectId, next.id);
    }
    this.touch(projectId);
    return true;
  }

  getRoot(rootId: string): ProjectRootRecord | undefined {
    const row = this.db
      .prepare(`SELECT * FROM project_roots WHERE id = ?`)
      .get(rootId) as Record<string, unknown> | undefined;
    return row ? mapRoot(row) : undefined;
  }

  private listRoots(projectId: string): ProjectRootRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM project_roots WHERE project_id = ? ORDER BY is_primary DESC, alias ASC`)
      .all(projectId) as Array<Record<string, unknown>>;
    return rows.map(mapRoot);
  }

  private insertRoot(projectId: string, alias: string, path: string, isPrimary: boolean): ProjectRootRecord {
    const id = createId('prf');
    this.db
      .prepare(
        `INSERT INTO project_roots (id, project_id, alias, path, is_primary) VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, projectId, alias, path, boolToInt(isPrimary));
    return { id, projectId, alias, path, isPrimary };
  }

  private setPrimary(projectId: string, rootId: string): void {
    this.db.prepare(`UPDATE project_roots SET is_primary = 0 WHERE project_id = ?`).run(projectId);
    this.db
      .prepare(`UPDATE project_roots SET is_primary = 1 WHERE id = ? AND project_id = ?`)
      .run(rootId, projectId);
  }

  private ensureOnePrimary(projectId: string): void {
    const roots = this.listRoots(projectId);
    if (!roots.length) return;
    if (!roots.some((r) => r.isPrimary)) this.setPrimary(projectId, roots[0]!.id);
  }

  private touch(id: string): void {
    this.db.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`).run(nowIso(), id);
  }

  private hydrate(row: Record<string, unknown>): ProjectRecord {
    const id = String(row.id);
    return {
      id,
      name: String(row.name),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      roots: this.listRoots(id)
    };
  }
}
