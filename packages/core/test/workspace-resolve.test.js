import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseWorkspacePathInput,
  resolvePathAgainstRoots,
  resolveWorkspacePath,
  uniqueAlias
} from '../dist/workspace/resolve.js';

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'ws-resolve-'));
}

test('parseWorkspacePathInput handles alias / relative / absolute', () => {
  assert.deepEqual(parseWorkspacePathInput('@frontend/src/App.tsx'), {
    kind: 'alias',
    alias: 'frontend',
    rest: 'src/App.tsx'
  });
  assert.deepEqual(parseWorkspacePathInput('@frontend'), {
    kind: 'alias',
    alias: 'frontend',
    rest: ''
  });
  assert.deepEqual(parseWorkspacePathInput('src/App.tsx'), {
    kind: 'relative',
    rest: 'src/App.tsx'
  });
  assert.equal(parseWorkspacePathInput('/abs/path').kind, 'absolute');
});

test('resolvePathAgainstRoots uses @alias and primary', () => {
  const dir = tmpDir();
  const front = join(dir, 'front');
  const back = join(dir, 'back');
  mkdirSync(front);
  mkdirSync(back);
  mkdirSync(join(front, 'src'), { recursive: true });
  writeFileSync(join(front, 'src', 'App.tsx'), 'x');
  try {
    const roots = [
      { alias: 'frontend', path: front, primary: true },
      { alias: 'backend', path: back }
    ];
    assert.equal(resolvePathAgainstRoots(roots, '@frontend/src/App.tsx'), join(realpathSync(front), 'src', 'App.tsx'));
    assert.equal(resolvePathAgainstRoots(roots, 'src/App.tsx'), join(realpathSync(front), 'src', 'App.tsx'));
    assert.equal(resolvePathAgainstRoots(roots, '@backend'), realpathSync(back));
    assert.equal(resolvePathAgainstRoots(roots, join(back, 'ok.txt')), join(realpathSync(back), 'ok.txt'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolvePathAgainstRoots rejects escape and unknown alias', () => {
  const dir = tmpDir();
  const front = join(dir, 'front');
  mkdirSync(front);
  try {
    const roots = [{ alias: 'frontend', path: front, primary: true }];
    assert.throws(() => resolvePathAgainstRoots(roots, '/etc/passwd'), /escapes workspace/);
    assert.throws(() => resolvePathAgainstRoots(roots, '@missing/x'), /Unknown workspace alias/);
    assert.throws(() => resolvePathAgainstRoots(roots, join(dir, 'other', 'x')), /escapes workspace/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveWorkspacePath falls back to repoRoot when no roots', () => {
  const dir = tmpDir();
  try {
    const abs = resolveWorkspacePath(
      {
        repoRoot: dir,
        stateDir: dir,
        session: { id: 's', metadata: {} },
        agent: { id: 'a', name: 'a', role: 'r', instructions: '', capabilities: [] }
      },
      'note.txt'
    );
    assert.equal(abs, join(realpathSync(dir), 'note.txt'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uniqueAlias avoids collisions', () => {
  assert.equal(uniqueAlias('Frontend App', []), 'frontend-app');
  assert.equal(uniqueAlias('frontend-app', ['frontend-app']), 'frontend-app-2');
});
