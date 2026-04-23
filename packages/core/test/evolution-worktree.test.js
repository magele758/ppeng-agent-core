import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { removeWorktree } from '../../../scripts/evolution/worktree.mjs';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function makeTempRepo() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'evolution-worktree-'));
  writeFileSync(join(repoRoot, 'README.md'), '# temp\n', 'utf8');
  git(repoRoot, 'init', '-b', 'main');
  git(repoRoot, 'config', 'user.name', 'Test User');
  git(repoRoot, 'config', 'user.email', 'test@example.com');
  git(repoRoot, 'add', 'README.md');
  git(repoRoot, 'commit', '-m', 'init');
  return repoRoot;
}

test('removeWorktree(deleteBranch=false) 保留实验分支', async () => {
  const repoRoot = makeTempRepo();
  const wtPath = join(repoRoot, '.wt-keep');
  const branch = 'exp/keep-branch';

  try {
    git(repoRoot, 'worktree', 'add', '-b', branch, wtPath, 'main');

    await removeWorktree(repoRoot, wtPath, branch, () => {}, false);

    assert.match(git(repoRoot, 'branch', '--list', branch), /keep-branch/);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test('removeWorktree(deleteBranch=true) 删除实验分支', async () => {
  const repoRoot = makeTempRepo();
  const wtPath = join(repoRoot, '.wt-drop');
  const branch = 'exp/drop-branch';

  try {
    git(repoRoot, 'worktree', 'add', '-b', branch, wtPath, 'main');

    await removeWorktree(repoRoot, wtPath, branch, () => {}, true);

    assert.equal(git(repoRoot, 'branch', '--list', branch), '');
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
