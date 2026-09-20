/**
 * Fail-soft compensate hooks for write_file / edit_file; bash is irreversible.
 * Node-only (`node:fs`) — full+, loaded via dynamic import. Path resolution
 * is injected so products keep their workspace sandbox.
 */

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { RunContext, ToolContract } from '../types.js';

type FileSnapshot =
  | { kind: 'missing'; path: string; abs: string }
  | { kind: 'file'; path: string; abs: string; content: string };

export type ResolveWorkspacePath = (context: RunContext, rel: string) => string;

export function defaultResolveWorkspacePath(context: RunContext, rel: string): string {
  const root = context.workspaceRoot ?? context.repoRoot ?? '';
  if (!rel) return root;
  return join(root, rel);
}

async function snapshotFile(
  context: RunContext,
  rel: string,
  resolvePath: ResolveWorkspacePath
): Promise<FileSnapshot> {
  const abs = resolvePath(context, rel);
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

function wrapWriteFile(
  tool: ToolContract<Record<string, unknown>>,
  resolvePath: ResolveWorkspacePath
): ToolContract<Record<string, unknown>> {
  return {
    ...tool,
    async captureSnapshot(context, args) {
      const path = typeof args.path === 'string' ? args.path : '';
      if (!path) return undefined;
      try {
        return await snapshotFile(context, path, resolvePath);
      } catch {
        return undefined;
      }
    },
    async compensate(_context, _args, snapshot) {
      if (!snapshot || typeof snapshot !== 'object') return;
      await restoreFile(snapshot as FileSnapshot);
    },
  };
}

function wrapEditFile(
  tool: ToolContract<Record<string, unknown>>,
  resolvePath: ResolveWorkspacePath
): ToolContract<Record<string, unknown>> {
  return {
    ...tool,
    async captureSnapshot(context, args) {
      const path = typeof args.path === 'string' ? args.path : '';
      if (!path) return undefined;
      try {
        return await snapshotFile(context, path, resolvePath);
      } catch {
        return undefined;
      }
    },
    async compensate(_context, _args, snapshot) {
      if (!snapshot || typeof snapshot !== 'object') return;
      const snap = snapshot as FileSnapshot;
      if (snap.kind === 'missing') return;
      await restoreFile(snap);
    },
  };
}

export function attachFileCompensation(
  tools: ToolContract<Record<string, unknown>>[],
  resolvePath: ResolveWorkspacePath = defaultResolveWorkspacePath
): ToolContract<Record<string, unknown>>[] {
  return tools.map((tool) => {
    if (tool.name === 'write_file') return wrapWriteFile(tool, resolvePath);
    if (tool.name === 'edit_file') return wrapEditFile(tool, resolvePath);
    if (tool.name === 'bash') return { ...tool, irreversible: true };
    return tool;
  });
}
