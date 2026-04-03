import { glob, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

export interface GlobFilesOptions {
  cwd: string;
  pattern: string;
  maxResults?: number;
}

/**
 * Workspace-relative glob using Node built-in `glob` (Node 22+).
 */
export async function globWorkspaceFiles(options: GlobFilesOptions): Promise<{ ok: boolean; content: string }> {
  const max = typeof options.maxResults === 'number' && options.maxResults > 0 ? options.maxResults : 200;
  const matches: string[] = [];
  try {
    const iter = glob(options.pattern, {
      cwd: options.cwd
    });
    for await (const entry of iter) {
      const rel = String(entry).replace(/\\/g, '/');
      const full = join(options.cwd, rel);
      try {
        const st = await stat(full);
        if (!st.isFile()) {
          continue;
        }
      } catch {
        continue;
      }
      const normalized = relative(options.cwd, full).replace(/\\/g, '/') || rel;
      matches.push(normalized);
      if (matches.length >= max) {
        matches.push(`... (truncated at ${max} paths)`);
        break;
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, content: `glob error: ${msg}` };
  }
  if (matches.length === 0) {
    return { ok: true, content: '(no matches)' };
  }
  return { ok: true, content: matches.join('\n') };
}
