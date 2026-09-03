import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { SqliteStateStore } from '../dist/storage.js';
import { browseLocalDir } from '../dist/workspace/browse.js';
import { CloudFolderPersist, MemoryCloudObjectStore, isS3Configured } from '../dist/workspace/cloud-persist.js';
import { WorkspaceUnavailableError } from '../dist/workspace/errors.js';
import { resolveEffectiveWorkspace } from '../dist/workspace/effective.js';

function tempSqlite() {
  const dir = mkdtempSync(join(tmpdir(), 'ws-store-'));
  const sqlite = new SqliteStateStore(join(dir, 'state.db'));
  return { dir, sqlite };
}

test('ProjectStore primary / unique alias / last root stays', () => {
  const { dir, sqlite } = tempSqlite();
  try {
    const store = sqlite.projects();
    const a = mkdtempSync(join(tmpdir(), 'root-a-'));
    const b = mkdtempSync(join(tmpdir(), 'root-b-'));
    const project = store.create({
      name: 'app',
      roots: [
        { path: a, alias: 'app' },
        { path: b, alias: 'app', primary: true }
      ]
    });
    assert.ok(project.id.startsWith('proj'));
    assert.equal(project.roots.length, 2);
    const primary = project.roots.filter((r) => r.isPrimary);
    assert.equal(primary.length, 1);
    assert.equal(primary[0].path, b);
    assert.ok(project.roots.some((r) => r.alias === 'app-2'));

    const last = project.roots.find((r) => r.isPrimary) ?? project.roots[0];
    const other = project.roots.find((r) => r.id !== last.id);
    assert.equal(store.removeRoot(project.id, last.id), true);
    const after = store.get(project.id);
    assert.equal(after.roots.length, 1);
    assert.equal(after.roots[0].id, other.id);
    assert.equal(after.roots[0].isPrimary, true);
    assert.equal(store.removeRoot(project.id, other.id), false);
  } finally {
    sqlite.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveEffectiveWorkspace does not fall back to repoRoot', async () => {
  const { dir, sqlite } = tempSqlite();
  try {
    await assert.rejects(
      () =>
        resolveEffectiveWorkspace({
          store: sqlite,
          session: { metadata: { workspaceBinding: { kind: 'project', projectId: 'missing' } } },
          repoRoot: dir,
          stateDir: dir
        }),
      (e) => e instanceof WorkspaceUnavailableError && e.statusCode === 422
    );

    const root = realpathSync(mkdtempSync(join(tmpdir(), 'proj-ok-')));
    const project = sqlite.projects().create({
      name: 'ok',
      roots: [{ path: root, alias: 'fe', primary: true }]
    });
    const resolved = await resolveEffectiveWorkspace({
      store: sqlite,
      session: { metadata: { workspaceBinding: { kind: 'project', projectId: project.id } } },
      repoRoot: dir,
      stateDir: dir
    });
    assert.equal(resolved.kind, 'project');
    assert.equal(resolved.workspaceRoot, root);
    assert.equal(resolved.workspaceRoots[0].alias, 'fe');
    assert.notEqual(resolved.workspaceRoot, dir);
  } finally {
    sqlite.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('browseLocalDir blocks /etc and hides .ssh under home', async () => {
  await assert.rejects(() => browseLocalDir('/etc'), /blocked/);
  const home = homedir();
  const listed = await browseLocalDir(home);
  assert.ok(!listed.entries.some((e) => e.name === '.ssh'));
});

test('browseLocalDir empty path defaults to home and reports parent', async () => {
  const home = resolve(homedir());
  const listed = await browseLocalDir('');
  assert.equal(listed.path, home);
  const expectedParent = dirname(home);
  if (expectedParent && expectedParent !== home) {
    assert.equal(listed.parent, expectedParent);
  } else {
    assert.equal(listed.parent, undefined);
  }
  assert.ok(listed.entries.every((e) => typeof e.isDir === 'boolean' && typeof e.path === 'string'));
});

test('MemoryCloudObjectStore persist/hydrate roundtrip when configured', async () => {
  assert.equal(isS3Configured({}), false);
  const mem = new MemoryCloudObjectStore();
  const persist = new CloudFolderPersist(mem, true);
  const local = mkdtempSync(join(tmpdir(), 'cloud-local-'));
  writeFileSync(join(local, 'note.txt'), 'hello-cloud');
  const n = await persist.persistAll('cfl1', local);
  assert.ok(n >= 1);
  const dest = mkdtempSync(join(tmpdir(), 'cloud-dest-'));
  const hydrated = await persist.hydrate('cfl1', dest);
  assert.ok(hydrated >= 1);
});

test('CloudFolderStore create/update/remove', () => {
  const { dir, sqlite } = tempSqlite();
  try {
    const folders = sqlite.cloudFolders();
    const rec = folders.create({
      name: 'notes',
      backend: 'local',
      localPath: join(dir, 'c'),
      s3Prefix: ''
    });
    assert.ok(rec.id.startsWith('cfl'));
    const updated = folders.update(rec.id, { name: 'docs' });
    assert.equal(updated.name, 'docs');
    assert.equal(folders.remove(rec.id), true);
    assert.equal(folders.get(rec.id), undefined);
  } finally {
    sqlite.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
