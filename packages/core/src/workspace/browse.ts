import { access, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { isBlockedPath } from './blocked.js';

export interface FsBrowseEntry {
  name: string;
  isDir: boolean;
  path: string;
}

export interface FsBrowseResult {
  path: string;
  parent?: string;
  entries: FsBrowseEntry[];
}

function browseParentOf(abs: string): string | undefined {
  const parent = dirname(abs);
  return parent && parent !== abs ? parent : undefined;
}

export async function browseLocalDir(input?: string): Promise<FsBrowseResult> {
  const fallback = homedir() || process.cwd();
  const requested = typeof input === 'string' && input.trim() ? input.trim() : fallback;
  if (!isAbsolute(requested)) {
    throw new Error('Browse path must be absolute');
  }
  const abs = resolve(requested);
  if (isBlockedPath(abs)) {
    throw new Error(`Path is blocked: ${abs}`);
  }
  const st = await stat(abs);
  if (!st.isDirectory()) {
    throw new Error(`Path is not a directory: ${abs}`);
  }
  await access(abs, constants.R_OK);
  const entries = await readdir(abs, { withFileTypes: true });
  const mapped: FsBrowseEntry[] = [];
  for (const entry of entries) {
    const child = resolve(abs, entry.name);
    if (isBlockedPath(child)) continue;
    mapped.push({
      name: entry.name,
      isDir: entry.isDirectory(),
      path: child
    });
  }
  mapped.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { path: abs, parent: browseParentOf(abs), entries: mapped };
}
