import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { WorkspaceManager } from '../dist/workspaces.js';

/**
 * All tests use directory-copy mode (no .git in sourceRoot).
 * Git-worktree mode is intentionally not tested here.
 */

describe('WorkspaceManager', () => {
  let base;

  before(async () => {
    base = await mkdtemp(join(tmpdir(), 'ws-test-'));
  });

  after(async () => {
    await rm(base, { recursive: true, force: true });
  });

  // ── createForTask ────────────────────────────────────────────

  describe('createForTask()', () => {
    let workspaceRoot;
    let sourceRoot;

    before(async () => {
      workspaceRoot = join(base, 'workspaces-create');
      sourceRoot = join(base, 'source-create');
      await mkdir(sourceRoot, { recursive: true });
      await writeFile(join(sourceRoot, 'hello.txt'), 'hello');
      await writeFile(join(sourceRoot, 'README.md'), '# readme');
    });

    it('creates workspace directory and returns a valid record', async () => {
      const mgr = new WorkspaceManager(workspaceRoot, sourceRoot);
      const rec = await mgr.createForTask('task-abc123');

      assert.ok(rec.id.startsWith('ws_'), 'id should start with ws_');
      assert.equal(rec.taskId, 'task-abc123');
      assert.equal(rec.status, 'active');
      assert.equal(rec.sourcePath, sourceRoot);
      assert.ok(rec.createdAt, 'createdAt should be set');
      assert.ok(existsSync(rec.rootPath), 'workspace directory should exist');
    });

    it('returns mode "directory-copy" when source has no .git', async () => {
      const mgr = new WorkspaceManager(workspaceRoot, sourceRoot);
      const rec = await mgr.createForTask('task-def456');
      assert.equal(rec.mode, 'directory-copy');
    });

    it('uses hint for the workspace name when provided', async () => {
      const mgr = new WorkspaceManager(workspaceRoot, sourceRoot);
      const rec = await mgr.createForTask('task-xyz789', 'my-feature');
      assert.equal(rec.name, 'my-feature');
      assert.ok(rec.rootPath.includes('my-feature'), 'rootPath should contain the hint');
    });

    it('falls back to taskId for the name when hint is omitted', async () => {
      const mgr = new WorkspaceManager(workspaceRoot, sourceRoot);
      const rec = await mgr.createForTask('task-fallback99');
      assert.equal(rec.name, 'task-fallback99');
    });

    it('embeds the last 6 chars of taskId in rootPath', async () => {
      const mgr = new WorkspaceManager(workspaceRoot, sourceRoot);
      const rec = await mgr.createForTask('id-abcdef123456');
      assert.ok(rec.rootPath.endsWith('123456'), 'rootPath should end with last 6 chars of taskId');
    });
  });

  // ── file copying & exclusions ────────────────────────────────

  describe('directory-copy exclusions', () => {
    let workspaceRoot;
    let sourceRoot;

    before(async () => {
      workspaceRoot = join(base, 'workspaces-copy');
      sourceRoot = join(base, 'source-copy');
      await mkdir(sourceRoot, { recursive: true });

      // Files that SHOULD be copied
      await writeFile(join(sourceRoot, 'index.js'), 'console.log("hi")');
      await mkdir(join(sourceRoot, 'src'), { recursive: true });
      await writeFile(join(sourceRoot, 'src', 'lib.js'), 'export default 1');

      // Directories that should be EXCLUDED
      await mkdir(join(sourceRoot, 'node_modules', 'pkg'), { recursive: true });
      await writeFile(join(sourceRoot, 'node_modules', 'pkg', 'index.js'), '//nm');

      await mkdir(join(sourceRoot, 'dist'), { recursive: true });
      await writeFile(join(sourceRoot, 'dist', 'bundle.js'), '//dist');

      await mkdir(join(sourceRoot, '.agent-state'), { recursive: true });
      await writeFile(join(sourceRoot, '.agent-state', 'state.json'), '{}');
    });

    it('copies regular files to the workspace', async () => {
      const mgr = new WorkspaceManager(workspaceRoot, sourceRoot);
      const rec = await mgr.createForTask('task-copy01');

      const content = await readFile(join(rec.rootPath, 'index.js'), 'utf8');
      assert.equal(content, 'console.log("hi")');
    });

    it('copies nested directories', async () => {
      const mgr = new WorkspaceManager(workspaceRoot, sourceRoot);
      const rec = await mgr.createForTask('task-copy02');

      const content = await readFile(join(rec.rootPath, 'src', 'lib.js'), 'utf8');
      assert.equal(content, 'export default 1');
    });

    it('excludes node_modules', async () => {
      const mgr = new WorkspaceManager(workspaceRoot, sourceRoot);
      const rec = await mgr.createForTask('task-copy03');
      assert.ok(!existsSync(join(rec.rootPath, 'node_modules')), 'node_modules should not be copied');
    });

    it('excludes dist/ contents', async () => {
      const mgr = new WorkspaceManager(workspaceRoot, sourceRoot);
      const rec = await mgr.createForTask('task-copy04');
      // The cp filter blocks files inside dist/ but the directory shell may exist (empty).
      // Verify no dist contents were copied.
      if (existsSync(join(rec.rootPath, 'dist'))) {
        const entries = await readdir(join(rec.rootPath, 'dist'));
        assert.equal(entries.length, 0, 'dist/ should be empty');
      }
    });

    it('excludes .agent-state', async () => {
      const mgr = new WorkspaceManager(workspaceRoot, sourceRoot);
      const rec = await mgr.createForTask('task-copy05');
      assert.ok(!existsSync(join(rec.rootPath, '.agent-state')), '.agent-state should not be copied');
    });
  });

  // ── archive ──────────────────────────────────────────────────

  describe('archive()', () => {
    let workspaceRoot;
    let sourceRoot;

    before(async () => {
      workspaceRoot = join(base, 'workspaces-archive');
      sourceRoot = join(base, 'source-archive');
      await mkdir(sourceRoot, { recursive: true });
      await writeFile(join(sourceRoot, 'file.txt'), 'data');
    });

    it('removes the workspace directory', async () => {
      const mgr = new WorkspaceManager(workspaceRoot, sourceRoot);
      const rec = await mgr.createForTask('task-arch01');
      assert.ok(existsSync(rec.rootPath), 'workspace should exist before archive');

      await mgr.archive(rec);
      assert.ok(!existsSync(rec.rootPath), 'workspace should be gone after archive');
    });

    it('does not throw when archiving an already-removed workspace', async () => {
      const mgr = new WorkspaceManager(workspaceRoot, sourceRoot);
      const rec = await mgr.createForTask('task-arch02');
      await rm(rec.rootPath, { recursive: true, force: true });

      // rm with force:true should not throw
      await assert.doesNotReject(() => mgr.archive(rec));
    });
  });

  // ── ensureExists ─────────────────────────────────────────────

  describe('ensureExists()', () => {
    let workspaceRoot;
    let sourceRoot;

    before(async () => {
      workspaceRoot = join(base, 'workspaces-ensure');
      sourceRoot = join(base, 'source-ensure');
      await mkdir(sourceRoot, { recursive: true });
      await writeFile(join(sourceRoot, 'f.txt'), 'ok');
    });

    it('resolves for an existing workspace path', async () => {
      const mgr = new WorkspaceManager(workspaceRoot, sourceRoot);
      const rec = await mgr.createForTask('task-ensure01');
      await assert.doesNotReject(() => mgr.ensureExists(rec.rootPath));
    });

    it('throws for a non-existent path', async () => {
      const mgr = new WorkspaceManager(workspaceRoot, sourceRoot);
      await assert.rejects(
        () => mgr.ensureExists(join(base, 'no-such-path')),
        { code: 'ENOENT' }
      );
    });
  });

  // ── sanitizeName (observed via rootPath / name) ──────────────

  describe('sanitizeName behavior', () => {
    let workspaceRoot;
    let sourceRoot;

    before(async () => {
      workspaceRoot = join(base, 'workspaces-sanitize');
      sourceRoot = join(base, 'source-sanitize');
      await mkdir(sourceRoot, { recursive: true });
    });

    it('lowercases and replaces special chars with hyphens', async () => {
      const mgr = new WorkspaceManager(workspaceRoot, sourceRoot);
      const rec = await mgr.createForTask('task-san01', 'Hello World!');
      assert.equal(rec.name, 'hello-world');
    });

    it('strips leading and trailing hyphens from sanitized name', async () => {
      const mgr = new WorkspaceManager(workspaceRoot, sourceRoot);
      const rec = await mgr.createForTask('task-san02', '---leading---');
      assert.equal(rec.name, 'leading');
    });

    it('truncates to 48 characters', async () => {
      const mgr = new WorkspaceManager(workspaceRoot, sourceRoot);
      const long = 'a'.repeat(100);
      const rec = await mgr.createForTask('task-san03', long);
      assert.ok(rec.name.length <= 48, 'name should be at most 48 chars');
    });

    it('falls back to "task" for an empty string hint', async () => {
      const mgr = new WorkspaceManager(workspaceRoot, sourceRoot);
      const rec = await mgr.createForTask('task-san04', '');
      // empty hint → sanitize('task-san04') from taskId fallback since hint ?? taskId
      // Actually: hint is '' which is falsy-ish but not nullish — '' ?? taskId = ''
      // sanitizeName('') → '' → falls back to 'task'
      assert.equal(rec.name, 'task');
    });

    it('preserves underscores and hyphens', async () => {
      const mgr = new WorkspaceManager(workspaceRoot, sourceRoot);
      const rec = await mgr.createForTask('task-san05', 'my_cool-feature');
      assert.equal(rec.name, 'my_cool-feature');
    });
  });
});
