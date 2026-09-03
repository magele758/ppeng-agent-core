import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import type { RunContext } from '../types.js';
import type { WorkspaceRootSpec } from './types.js';

export function sanitizeAlias(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || 'root';
}

export function uniqueAlias(desired: string, taken: Iterable<string>): string {
  const base = sanitizeAlias(desired);
  const used = new Set([...taken].map((a) => a.toLowerCase()));
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const next = `${base}-${i}`.slice(0, 48);
    if (!used.has(next)) return next;
  }
  return `${base}-${Date.now().toString(36)}`.slice(0, 48);
}

export function primaryWorkspacePath(context: RunContext): string {
  const roots = context.workspaceRoots;
  if (roots?.length) {
    const primary = roots.find((r) => r.primary) ?? roots[0]!;
    return primary.path;
  }
  return context.workspaceRoot ?? context.repoRoot;
}

export function sandboxWorkspaceRoots(context: RunContext): string[] {
  if (context.workspaceRoots?.length) {
    return [...new Set(context.workspaceRoots.map((r) => r.path).filter(Boolean))];
  }
  return [context.workspaceRoot ?? context.repoRoot];
}

export function defaultWorkspaceRoots(
  workspaceRoot: string | undefined,
  repoRoot: string
): WorkspaceRootSpec[] {
  return [{ alias: 'repo', path: workspaceRoot ?? repoRoot, primary: true }];
}

function isInsideRoot(candidate: string, root: string): boolean {
  const a = resolve(candidate);
  const b = resolve(root);
  return a === b || a.startsWith(b + sep);
}

function existingRealPrefix(abs: string): { base: string; rest: string } {
  let cur = resolve(abs);
  const parts: string[] = [];
  while (true) {
    if (existsSync(cur)) {
      let base = cur;
      try {
        base = realpathSync(cur);
      } catch {
        /* keep cur */
      }
      return { base, rest: parts.reverse().join(sep) };
    }
    const parent = dirname(cur);
    if (parent === cur) {
      return { base: cur, rest: parts.reverse().join(sep) };
    }
    parts.push(basename(cur));
    cur = parent;
  }
}

function realRootPath(root: string): string {
  try {
    return existsSync(root) ? realpathSync(root) : resolve(root);
  } catch {
    return resolve(root);
  }
}

export function parseWorkspacePathInput(
  input: string
): { kind: 'alias'; alias: string; rest: string } | { kind: 'relative'; rest: string } | { kind: 'absolute'; path: string } {
  const raw = input.trim();
  if (!raw) return { kind: 'relative', rest: '' };
  if (raw.startsWith('@')) {
    const body = raw.slice(1);
    const slash = body.search(/[\\/]/);
    if (slash < 0) return { kind: 'alias', alias: body, rest: '' };
    return { kind: 'alias', alias: body.slice(0, slash), rest: body.slice(slash + 1) };
  }
  if (isAbsolute(raw)) return { kind: 'absolute', path: raw };
  return { kind: 'relative', rest: raw };
}

export function resolvePathAgainstRoots(roots: WorkspaceRootSpec[], input: string): string {
  if (!roots.length) {
    throw new Error('No workspace roots are bound');
  }
  const parsed = parseWorkspacePathInput(input);
  let candidate: string;
  if (parsed.kind === 'alias') {
    const alias = parsed.alias.trim().toLowerCase();
    const root = roots.find((r) => r.alias.toLowerCase() === alias);
    if (!root) {
      const known = roots.map((r) => `@${r.alias}`).join(', ');
      throw new Error(`Unknown workspace alias @${parsed.alias}. Known: ${known || '(none)'}`);
    }
    candidate = parsed.rest ? join(root.path, parsed.rest) : root.path;
  } else if (parsed.kind === 'absolute') {
    candidate = parsed.path;
  } else {
    const primary = roots.find((r) => r.primary) ?? roots[0]!;
    candidate = parsed.rest ? join(primary.path, parsed.rest) : primary.path;
  }

  const normalized = resolve(normalize(candidate));
  const { base, rest } = existingRealPrefix(normalized);
  const resolved = rest ? join(base, rest) : base;
  const authorized = roots.some((r) => isInsideRoot(resolved, realRootPath(r.path)));
  if (!authorized) {
    throw new Error(`Path escapes workspace: ${input}`);
  }
  return resolved;
}

export function resolveWorkspacePath(context: RunContext, path: string): string {
  const roots =
    context.workspaceRoots?.length
      ? context.workspaceRoots
      : defaultWorkspaceRoots(context.workspaceRoot, context.repoRoot);
  return resolvePathAgainstRoots(roots, path);
}
