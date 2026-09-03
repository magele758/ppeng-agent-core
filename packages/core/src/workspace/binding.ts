import {
  WORKSPACE_BINDING_BOUND_KEY,
  WORKSPACE_KINDS,
  type WorkspaceBinding,
  type WorkspaceKind
} from './types.js';

const KIND_SET = new Set<string>(WORKSPACE_KINDS);

export function parseWorkspaceKind(raw: unknown): WorkspaceKind | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  return KIND_SET.has(value) ? (value as WorkspaceKind) : undefined;
}

export function parseWorkspaceBinding(raw: unknown): WorkspaceBinding | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'string') {
    const kind = parseWorkspaceKind(raw);
    return kind ? { kind } : undefined;
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const rec = raw as Record<string, unknown>;
  const kind = parseWorkspaceKind(rec.kind);
  if (!kind) return undefined;
  const projectId =
    typeof rec.projectId === 'string' && rec.projectId.trim() ? rec.projectId.trim() : undefined;
  const cloudFolderId =
    typeof rec.cloudFolderId === 'string' && rec.cloudFolderId.trim()
      ? rec.cloudFolderId.trim()
      : undefined;
  if (kind === 'project' && !projectId) return undefined;
  if (kind === 'cloud_folder' && !cloudFolderId) return undefined;
  if (kind === 'default') return { kind: 'default' };
  if (kind === 'project') return { kind: 'project', projectId };
  return { kind: 'cloud_folder', cloudFolderId };
}

export function workspaceBindingFromMetadata(
  metadata: Record<string, unknown> | undefined
): WorkspaceBinding {
  return parseWorkspaceBinding(metadata?.workspaceBinding) ?? { kind: 'default' };
}

export function isWorkspaceBindingBound(metadata: Record<string, unknown> | undefined): boolean {
  return metadata?.[WORKSPACE_BINDING_BOUND_KEY] === true;
}

export function workspaceBindingsEqual(a: WorkspaceBinding, b: WorkspaceBinding): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'project') return a.projectId === b.projectId;
  if (a.kind === 'cloud_folder') return a.cloudFolderId === b.cloudFolderId;
  return true;
}

export type WorkspaceBindingPatchResult =
  | { ok: true; patch: Record<string, unknown> }
  | { ok: false; reason: 'bound'; bound: WorkspaceBinding };

export function applyUnboundWorkspaceBindingPatch(
  existing: Record<string, unknown> | undefined,
  incoming: WorkspaceBinding | undefined
): WorkspaceBindingPatchResult {
  if (!incoming) return { ok: true, patch: {} };
  const bound = workspaceBindingFromMetadata(existing);
  // leftover workspaceBindingBound on default must not lock — treat as unbound
  if (!isWorkspaceBindingBound(existing) || bound.kind === 'default') {
    return { ok: true, patch: { workspaceBinding: incoming } };
  }
  if (workspaceBindingsEqual(bound, incoming)) return { ok: true, patch: {} };
  return { ok: false, reason: 'bound', bound };
}

export function sealWorkspaceBindingPatch(
  metadata: Record<string, unknown> | undefined,
  binding: WorkspaceBinding
): Record<string, unknown> {
  if (binding.kind === 'default') return {};
  if (isWorkspaceBindingBound(metadata) && workspaceBindingsEqual(workspaceBindingFromMetadata(metadata), binding)) {
    return {};
  }
  return { workspaceBinding: binding, [WORKSPACE_BINDING_BOUND_KEY]: true };
}

export function inheritWorkspaceBinding(
  parent: Record<string, unknown> | undefined
): Record<string, unknown> {
  const binding = parseWorkspaceBinding(parent?.workspaceBinding);
  if (!binding || binding.kind === 'default') return {};
  const patch: Record<string, unknown> = { workspaceBinding: binding };
  if (isWorkspaceBindingBound(parent)) {
    patch[WORKSPACE_BINDING_BOUND_KEY] = true;
  }
  return patch;
}
