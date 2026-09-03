import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { isBlockedPath } from '../dist/workspace/blocked.js';
import { validateWorkspaceRootPath } from '../dist/workspace/validate.js';

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'ws-validate-'));
}

test('validateWorkspaceRootPath rejects relative paths', async () => {
  const r = await validateWorkspaceRootPath('relative/dir');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'not_absolute');
});

test('validateWorkspaceRootPath rejects missing dirs', async () => {
  const r = await validateWorkspaceRootPath(join(tmpdir(), 'no-such-ws-root-xyz'));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'not_found');
});

test('validateWorkspaceRootPath rejects files', async () => {
  const dir = tmpDir();
  try {
    const file = join(dir, 'file.txt');
    writeFileSync(file, 'x');
    const r = await validateWorkspaceRootPath(file);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'not_directory');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('validateWorkspaceRootPath rejects symlink segments', async () => {
  const dir = tmpDir();
  try {
    const real = join(dir, 'real');
    const link = join(dir, 'link');
    mkdirSync(real);
    symlinkSync(real, link);
    const r = await validateWorkspaceRootPath(link);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'symlink');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('validateWorkspaceRootPath rejects blocked paths', async () => {
  const ssh = join(homedir(), '.ssh');
  assert.equal(isBlockedPath(ssh), true);
  const r = await validateWorkspaceRootPath(ssh);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'blocked');
});

test('validateWorkspaceRootPath accepts a writable real directory', async () => {
  const dir = tmpDir();
  try {
    const r = await validateWorkspaceRootPath(dir);
    assert.equal(r.ok, true);
    assert.ok(r.path.endsWith(dir.slice(-8)) || r.path.includes('ws-validate-'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isBlockedPath covers /etc and home secrets', () => {
  assert.equal(isBlockedPath('/etc/passwd'), true);
  assert.equal(isBlockedPath(join(homedir(), '.aws', 'credentials')), true);
  assert.equal(isBlockedPath(join(homedir(), '.gnupg')), true);
  const dir = tmpDir();
  try {
    assert.equal(isBlockedPath(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('validateWorkspaceRootPath rejects unreadable dirs when possible', async () => {
  if (process.platform === 'win32' || process.getuid?.() === 0) return;
  const dir = tmpDir();
  try {
    chmodSync(dir, 0);
    const r = await validateWorkspaceRootPath(dir);
    assert.equal(r.ok, false);
    assert.ok(r.code === 'not_readable' || r.code === 'not_writable');
  } finally {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  }
});
