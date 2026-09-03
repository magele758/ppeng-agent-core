import { access, lstat, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import { isBlockedPath } from './blocked.js';
import type { WorkspacePathValidationResult } from './types.js';

/** macOS volume aliases — not user-controlled workspace hops. */
export function canonicalizeSystemPrefix(absPath: string): string {
  const p = resolve(absPath);
  for (const prefix of ['/tmp', '/var', '/etc']) {
    if (p === prefix || p.startsWith(`${prefix}/`)) {
      return `/private${p}`;
    }
  }
  return p;
}

async function isUserControlledSymlink(absPath: string): Promise<boolean> {
  const st = await lstat(absPath);
  if (!st.isSymbolicLink()) return false;
  const real = await realpath(absPath);
  return real !== canonicalizeSystemPrefix(absPath);
}

async function rejectSymlinkSegments(absPath: string): Promise<string | undefined> {
  const resolved = resolve(absPath);
  const parts = resolved.split(sep).filter(Boolean);
  let cur = resolved.startsWith(sep) ? sep : '';
  for (const part of parts) {
    cur = cur === sep ? `${sep}${part}` : cur ? `${cur}${sep}${part}` : part;
    try {
      if (await isUserControlledSymlink(cur)) return cur;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export async function validateWorkspaceRootPath(
  input: string,
  home?: string
): Promise<WorkspacePathValidationResult> {
  const trimmed = input.trim();
  if (!trimmed || !isAbsolute(trimmed)) {
    return { ok: false, code: 'not_absolute', message: 'Path must be an absolute directory' };
  }
  const abs = resolve(trimmed);
  if (isBlockedPath(abs, home)) {
    return { ok: false, code: 'blocked', message: `Path is blocked: ${abs}` };
  }
  const symlink = await rejectSymlinkSegments(abs);
  if (symlink) {
    return { ok: false, code: 'symlink', message: `Symlink segment is not allowed: ${symlink}` };
  }
  try {
    const st = await stat(abs);
    if (!st.isDirectory()) {
      return { ok: false, code: 'not_directory', message: `Path is not a directory: ${abs}` };
    }
  } catch {
    return { ok: false, code: 'not_found', message: `Directory not found: ${abs}` };
  }
  try {
    await access(abs, constants.R_OK);
  } catch {
    return { ok: false, code: 'not_readable', message: `Directory is not readable: ${abs}` };
  }
  try {
    await access(abs, constants.W_OK);
  } catch {
    return { ok: false, code: 'not_writable', message: `Directory is not writable: ${abs}` };
  }
  const real = await realpath(abs);
  if (isBlockedPath(real, home)) {
    return { ok: false, code: 'blocked', message: `Path is blocked: ${real}` };
  }
  return { ok: true, path: real };
}
