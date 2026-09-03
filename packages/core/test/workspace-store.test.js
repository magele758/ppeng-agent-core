import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStateStore } from '../dist/storage.js';
import { WorkspaceUnavailableError } from '../dist/workspace/errors.js';
import { resolveEffectiveWorkspace } from '../dist/workspace/effective.js';

function tmpState() {
  const dir = mkdtempSync(join(tmpdir(), 'ws-store-'));
  const store = new SqliteStateStore(join(dir, 'runtime.sqlite'));
  return { dir, store };
}

test('project store CRUD and roots', () => {
  const { dir, store } = tmpState();
  const a = join(dir, 'a');
  const b = join(dir, 'b');
  mkdirSync(a);
  mkdirSync(b);
  try {
    const projects = store.projects();
    const created = projects.create({
      name: 'App',
      roots: [
        { path: a, alias: 'frontend', primary: true },
        { path: b, alias: 'backend' }
      ]
    });
    assert.equal(created.name, 'App');
    assert.equal(created.roots.length, 2);
    assert.equal(created.roots.find((r) => r.alias === 'frontend')?.isPrimary, true);

    const listed = projects.list();
    assert.equal(listed.length, 1);

    const renamed = projects.update(created.id, { name: 'App 2' });
    assert.equal(renamed?.name, 'App 2');

    const extra = join(dir, 'c');
    mkdirSync(extra);
    const root = projects.addRoot(created.id, { path: extra, alias: 'docs' });
    assert.ok(root);
    assert.equal(projects.get(created.id)?.roots.length, 3);

    assert.equal(projects.removeRoot(created.id, root.id), true);
    assert.equal(projects.get(created.id)?.roots.length, 2);

    const primary = created.roots.find((r) => r.isPrimary);
    const other = created.roots.find((r) => !r.isPrimary);
    assert.equal(projects.removeRoot(created.id, other.id), true);
    assert.equal(projects.removeRoot(created.id, primary.id), false);

    assert.equal(projects.remove(created.id), true);
    assert.equal(projects.get(created.id), undefined);
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('effective workspace throws WORKSPACE_UNAVAILABLE for missing project', async () => {
  const { dir, store } = tmpState();
  try {
    await assert.rejects(
      () =>
        resolveEffectiveWorkspace({
          store,
          session: { metadata: { workspaceBinding: { kind: 'project', projectId: 'missing' } } },
          repoRoot: dir,
          stateDir: dir
        }),
      (err) => err instanceof WorkspaceUnavailableError && err.code === 'WORKSPACE_UNAVAILABLE'
    );
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('effective workspace resolves project roots and refuses deleted primary', async () => {
  const { dir, store } = tmpState();
  const a = join(dir, 'a');
  mkdirSync(a);
  try {
    const project = store.projects().create({
      name: 'Gone',
      roots: [{ path: a, alias: 'app', primary: true }]
    });
    const ok = await resolveEffectiveWorkspace({
      store,
      session: { metadata: { workspaceBinding: { kind: 'project', projectId: project.id } } },
      repoRoot: dir,
      stateDir: dir
    });
    assert.equal(ok.kind, 'project');
    assert.equal(ok.workspaceRoots[0]?.alias, 'app');

    rmSync(a, { recursive: true, force: true });
    await assert.rejects(
      () =>
        resolveEffectiveWorkspace({
          store,
          session: { metadata: { workspaceBinding: { kind: 'project', projectId: project.id } } },
          repoRoot: dir,
          stateDir: dir
        }),
      (err) => err instanceof WorkspaceUnavailableError
    );
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
