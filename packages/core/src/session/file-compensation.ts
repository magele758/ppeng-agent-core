/**
 * Fail-soft compensate hooks for write_file / edit_file; bash is irreversible.
 * Applied after builtin-tools construction — does not rewrite tool bodies.
 */

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { RunContext, ToolContract } from '../types.js';
import { resolveWorkspacePath } from '../workspace/index.js';

type FileSnapshot =
  | { kind: 'missing'; path: string; abs: string }
  | { kind: 'file'; path: string; abs: string; content: string };

function safeAbs(context: RunContext, rel: string): string {
  return resolveWorkspacePath(context, rel);
}

async function snapshotFile(context: RunContext, rel: string): Promise<FileSnapshot> {
  const abs = safeAbs(context, rel);
  try {
    const content = await readFile(abs, 'utf8');
    return { kind: 'file', path: rel, abs, content };
  } catch {
    return { kind: 'missing', path: rel, abs };
  }
}

async function restoreFile(snapshot: FileSnapshot): Promise<void> {
  if (snapshot.kind === 'missing') {
    try {
      await unlink(snapshot.abs);
    } catch {
      /* already gone */
    }
    return;
  }
  await mkdir(dirname(snapshot.abs), { recursive: true });
  await writeFile(snapshot.abs, snapshot.content, 'utf8');
}

function wrapWriteFile(tool: ToolContract<any>): ToolContract<any> {
  return {
    ...tool,
    async captureSnapshot(context, args) {
      const path = typeof args.path === 'string' ? args.path : '';
      if (!path) return undefined;
      try {
        return await snapshotFile(context, path);
      } catch {
        return undefined;
      }
    },
    async compensate(_context, _args, snapshot) {
      if (!snapshot || typeof snapshot !== 'object') return;
      await restoreFile(snapshot as FileSnapshot);
    }
  };
}

function wrapEditFile(tool: ToolContract<any>): ToolContract<any> {
  return {
    ...tool,
    async captureSnapshot(context, args) {
      const path = typeof args.path === 'string' ? args.path : '';
      if (!path) return undefined;
      try {
        return await snapshotFile(context, path);
      } catch {
        return undefined;
      }
    },
    async compensate(_context, _args, snapshot) {
      if (!snapshot || typeof snapshot !== 'object') return;
      const snap = snapshot as FileSnapshot;
      if (snap.kind === 'missing') return;
      await restoreFile(snap);
    }
  };
}

export function attachFileCompensation(tools: ToolContract<any>[]): ToolContract<any>[] {
  return tools.map((tool) => {
    if (tool.name === 'write_file') return wrapWriteFile(tool);
    if (tool.name === 'edit_file') return wrapEditFile(tool);
    if (tool.name === 'bash') return { ...tool, irreversible: true };
    return tool;
  });
}
