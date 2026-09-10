/** Lab workspace binding: default / Project / cloud folder. Pure helpers. */

export type WorkspaceBindingKind = 'default' | 'project' | 'cloud_folder';

export type WorkspaceBinding = {
  kind: WorkspaceBindingKind;
  projectId?: string;
  cloudFolderId?: string;
};

export type LabProjectRoot = {
  id: string;
  path: string;
  alias?: string;
  isPrimary?: boolean;
};

export type LabProject = {
  id: string;
  name: string;
  roots: LabProjectRoot[];
};

export type LabCloudFolder = {
  id: string;
  name: string;
  backend: 's3' | 'local';
  localPath: string;
};

export type FsValidateResult = {
  ok: boolean;
  realPath?: string;
  error?: string;
  code?: string;
};

export type FsBrowseEntry = {
  name: string;
  kind: 'dir' | 'file';
  path?: string;
};

export type FsBrowseResult = {
  path: string;
  parent?: string;
  entries: FsBrowseEntry[];
};

export type RootAvailability = {
  path: string;
  alias?: string;
  ok: boolean;
  realPath?: string;
  error?: string;
  code?: string;
};

export type WorkspaceBlockCode =
  | 'project_unselected'
  | 'cloud_unselected'
  | 'roots_unavailable'
  | 'project_empty';

export type WorkspaceBlockInfo = {
  code: WorkspaceBlockCode;
  bound?: boolean;
  names?: string;
  detail?: string;
};

export type WorkspaceAvailability = {
  checking: boolean;
  roots: RootAvailability[];
  blocked: boolean;
  reason: string | null;
  block: WorkspaceBlockInfo | null;
};

export type DraftValidationError = 'name_required' | 'root_required' | 'root_path_dup' | 'root_alias_dup';

export type WorkspaceLabelCopy = {
  defaultLabel: string;
  project: string;
  cloud: string;
};

export type WorkspacePickerValue =
  | { kind: 'default' }
  | { kind: 'project'; projectId: string }
  | { kind: 'cloud_folder'; cloudFolderId: string }
  | { kind: 'new_project' }
  | { kind: 'new_cloud' };

export type ProjectRootDraft = {
  path: string;
  alias?: string;
};

const DEFAULT_BINDING: WorkspaceBinding = { kind: 'default' };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function defaultWorkspaceBinding(): WorkspaceBinding {
  return { ...DEFAULT_BINDING };
}

export function normalizeWorkspaceBinding(raw: unknown): WorkspaceBinding {
  const o = asRecord(raw);
  if (!o) return defaultWorkspaceBinding();
  const kindRaw = o.kind;
  if (kindRaw === 'project') {
    const projectId = str(o.projectId) ?? str(o.project_id);
    return { kind: 'project', projectId };
  }
  if (kindRaw === 'cloud_folder' || kindRaw === 'cloudFolder') {
    const cloudFolderId = str(o.cloudFolderId) ?? str(o.cloud_folder_id);
    return { kind: 'cloud_folder', cloudFolderId };
  }
  return defaultWorkspaceBinding();
}

export function parseWorkspaceBinding(
  metadata?: Record<string, unknown> | null
): WorkspaceBinding {
  const m = metadata ?? {};
  return normalizeWorkspaceBinding(m.workspaceBinding ?? m.workspace_binding);
}

export function parseWorkspaceBindingBound(metadata?: Record<string, unknown> | null): boolean {
  const m = metadata ?? {};
  return m.workspaceBindingBound === true || m.workspace_binding_bound === true;
}

export function workspaceBindingsEqual(a: WorkspaceBinding, b: WorkspaceBinding): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'default') return true;
  if (a.kind === 'project') return (a.projectId ?? '') === (b.projectId ?? '');
  return (a.cloudFolderId ?? '') === (b.cloudFolderId ?? '');
}

export function workspaceBindingBody(binding: WorkspaceBinding): { workspaceBinding: WorkspaceBinding } {
  if (binding.kind === 'project') {
    return { workspaceBinding: { kind: 'project', projectId: binding.projectId } };
  }
  if (binding.kind === 'cloud_folder') {
    return { workspaceBinding: { kind: 'cloud_folder', cloudFolderId: binding.cloudFolderId } };
  }
  return { workspaceBinding: { kind: 'default' } };
}

/** Default is never write-once, even if a leftover `workspaceBindingBound` flag is set. */
export function canChangeWorkspaceBinding(
  bound: boolean,
  binding?: WorkspaceBinding
): boolean {
  if (binding?.kind === 'default') return true;
  return !bound;
}

export function workspaceBindingLabel(
  binding: WorkspaceBinding,
  names?: { projectName?: string; cloudFolderName?: string },
  copy?: WorkspaceLabelCopy
): string {
  const labels = copy ?? { defaultLabel: 'Default', project: 'Project', cloud: 'Cloud' };
  if (binding.kind === 'project') {
    return names?.projectName ? `${labels.project} · ${names.projectName}` : labels.project;
  }
  if (binding.kind === 'cloud_folder') {
    return names?.cloudFolderName ? `${labels.cloud} · ${names.cloudFolderName}` : labels.cloud;
  }
  return labels.defaultLabel;
}

export function formatRootList(roots: Array<{ path: string; alias?: string }>): string {
  return roots
    .map((r) => {
      const alias = r.alias?.trim();
      return alias ? `@${alias} ${r.path}` : r.path;
    })
    .join(' · ');
}

export function primaryRoot<T extends { isPrimary?: boolean }>(roots: T[]): T | undefined {
  return roots.find((r) => r.isPrimary) ?? roots[0];
}

export function isWorkspaceUnavailableCode(code?: string): boolean {
  return code === 'WORKSPACE_UNAVAILABLE';
}

export function formatUnavailableMessage(
  roots: RootAvailability[],
  bound = false
): WorkspaceBlockInfo {
  const bad = roots.filter((r) => !r.ok);
  return {
    code: 'roots_unavailable',
    bound,
    names: bad.map((r) => r.alias || r.path).join(', ') || undefined,
    detail: bad.find((r) => r.error)?.error
  };
}

export function workspaceSendBlockReason(input: {
  binding: WorkspaceBinding;
  roots: RootAvailability[];
  bound?: boolean;
  checking?: boolean;
}): WorkspaceBlockInfo | null {
  const { binding, roots, bound = false, checking = false } = input;
  if (binding.kind === 'default') return null;
  if (binding.kind === 'project' && !binding.projectId) return { code: 'project_unselected' };
  if (binding.kind === 'cloud_folder' && !binding.cloudFolderId) return { code: 'cloud_unselected' };
  const bad = roots.filter((r) => !r.ok);
  if (bad.length) return formatUnavailableMessage(roots, bound);
  if (binding.kind === 'project' && roots.length === 0 && !checking) {
    return { code: 'project_empty', bound };
  }
  return null;
}

export function translateWorkspaceBlock(
  info: WorkspaceBlockInfo,
  t: (key: string, vars?: Record<string, string | number>) => string
): string {
  switch (info.code) {
    case 'project_unselected':
      return t('play.workspacePicker.blockProjectUnselected');
    case 'cloud_unselected':
      return t('play.workspacePicker.blockCloudUnselected');
    case 'roots_unavailable':
      return t(
        info.bound ? 'play.workspacePicker.blockUnavailableSealed' : 'play.workspacePicker.blockUnavailable',
        {
          names: info.names || t('play.workspacePicker.unknownRoot'),
          detail: info.detail ? t('play.workspacePicker.blockDetail', { detail: info.detail }) : ''
        }
      );
    case 'project_empty':
      return t(
        info.bound ? 'play.workspacePicker.blockProjectEmptySealed' : 'play.workspacePicker.blockProjectEmpty'
      );
    default: {
      const _exhaustive: never = info.code;
      return _exhaustive;
    }
  }
}

export function emptyWorkspaceAvailability(): WorkspaceAvailability {
  return { checking: false, roots: [], blocked: false, reason: null, block: null };
}

export function workspaceAvailabilityFrom(
  binding: WorkspaceBinding,
  roots: RootAvailability[],
  opts?: {
    bound?: boolean;
    checking?: boolean;
    formatReason?: (info: WorkspaceBlockInfo) => string;
  }
): WorkspaceAvailability {
  const checking = opts?.checking ?? false;
  const block = workspaceSendBlockReason({
    binding,
    roots,
    bound: opts?.bound,
    checking
  });
  const reason = block ? (opts?.formatReason ? opts.formatReason(block) : block.code) : null;
  return { checking, roots, blocked: Boolean(block), reason, block };
}

export function encodeWorkspacePickerValue(value: WorkspacePickerValue): string {
  if (value.kind === 'new_project') return '__new_project';
  if (value.kind === 'new_cloud') return '__new_cloud';
  if (value.kind === 'project') return `project:${value.projectId}`;
  if (value.kind === 'cloud_folder') return `cloud:${value.cloudFolderId}`;
  return 'default';
}

export function decodeWorkspacePickerValue(raw: string): WorkspacePickerValue {
  if (raw === '__new_project') return { kind: 'new_project' };
  if (raw === '__new_cloud') return { kind: 'new_cloud' };
  if (raw === 'default' || raw === '') return { kind: 'default' };
  if (raw.startsWith('project:')) {
    return { kind: 'project', projectId: raw.slice('project:'.length) };
  }
  if (raw.startsWith('cloud:')) {
    return { kind: 'cloud_folder', cloudFolderId: raw.slice('cloud:'.length) };
  }
  return { kind: 'default' };
}

export function pickerValueFromBinding(binding: WorkspaceBinding): WorkspacePickerValue {
  if (binding.kind === 'project' && binding.projectId) {
    return { kind: 'project', projectId: binding.projectId };
  }
  if (binding.kind === 'cloud_folder' && binding.cloudFolderId) {
    return { kind: 'cloud_folder', cloudFolderId: binding.cloudFolderId };
  }
  return { kind: 'default' };
}

export function bindingFromPickerValue(value: WorkspacePickerValue): WorkspaceBinding | null {
  if (value.kind === 'new_project' || value.kind === 'new_cloud') return null;
  if (value.kind === 'project') return { kind: 'project', projectId: value.projectId };
  if (value.kind === 'cloud_folder') return { kind: 'cloud_folder', cloudFolderId: value.cloudFolderId };
  return { kind: 'default' };
}

export function validateNewProjectDraft(
  name: string,
  roots: ProjectRootDraft[]
): { ok: true } | { ok: false; error: DraftValidationError } {
  if (!name.trim()) return { ok: false, error: 'name_required' };
  const paths = roots.map((r) => normalizeRootPath(r.path)).filter(Boolean);
  if (!paths.length) return { ok: false, error: 'root_required' };
  if (new Set(paths).size !== paths.length) return { ok: false, error: 'root_path_dup' };
  const aliases = roots.map((r) => (r.alias ?? '').trim()).filter(Boolean);
  if (new Set(aliases).size !== aliases.length) return { ok: false, error: 'root_alias_dup' };
  return { ok: true };
}

export function validateNewCloudDraft(name: string): { ok: true } | { ok: false; error: DraftValidationError } {
  if (!name.trim()) return { ok: false, error: 'name_required' };
  return { ok: true };
}

/** Strip trailing slashes except filesystem root. */
export function normalizeRootPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return '';
  if (trimmed === '/' || /^[A-Za-z]:[\\/]?$/.test(trimmed)) return trimmed.replace(/[\\/]+$/, '') || trimmed;
  return trimmed.replace(/[\\/]+$/, '');
}

export function basenameFromPath(path: string): string {
  const normalized = normalizeRootPath(path);
  if (!normalized) return '';
  if (normalized === '/' || /^[A-Za-z]:$/.test(normalized)) return normalized;
  const idx = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  return idx < 0 ? normalized : normalized.slice(idx + 1);
}

export function defaultProjectNameFromRoots(roots: Array<{ path: string; alias?: string }>): string {
  const first = roots.find((r) => normalizeRootPath(r.path));
  if (!first) return '';
  return first.alias?.trim() || basenameFromPath(first.path);
}

export function rootPathTaken(roots: Array<{ path: string }>, path: string): boolean {
  const norm = normalizeRootPath(path);
  if (!norm) return false;
  return roots.some((r) => normalizeRootPath(r.path) === norm);
}

export function shortPath(path: string, max = 42): string {
  const trimmed = path.trim();
  if (trimmed.length <= max) return trimmed;
  return `…${trimmed.slice(-(max - 1))}`;
}

export function parseProjectRoot(raw: unknown): LabProjectRoot | null {
  const o = asRecord(raw);
  if (!o) return null;
  const path = typeof o.path === 'string' ? o.path : '';
  if (!path) return null;
  const id = str(o.id) ?? path;
  const alias = str(o.alias);
  const isPrimary = o.isPrimary === true || o.is_primary === true || o.primary === true;
  return { id, path, alias, isPrimary };
}

export function parseProject(raw: unknown): LabProject | null {
  const o = asRecord(raw);
  if (!o) return null;
  const id = str(o.id);
  if (!id) return null;
  const name = typeof o.name === 'string' && o.name.trim() ? o.name : id;
  const rootsRaw = o.roots ?? o.projectRoots ?? o.project_roots;
  const roots = Array.isArray(rootsRaw)
    ? rootsRaw.map(parseProjectRoot).filter((r): r is LabProjectRoot => r !== null)
    : [];
  return { id, name, roots };
}

export function parseProjectsResponse(data: unknown): LabProject[] {
  if (Array.isArray(data)) {
    return data.map(parseProject).filter((p): p is LabProject => p !== null);
  }
  const o = asRecord(data);
  if (!o) return [];
  const list = o.projects ?? o.items ?? o.data;
  if (Array.isArray(list)) {
    return list.map(parseProject).filter((p): p is LabProject => p !== null);
  }
  const one = parseProject(o.project ?? o);
  return one ? [one] : [];
}

export function parseCloudFolder(raw: unknown): LabCloudFolder | null {
  const o = asRecord(raw);
  if (!o) return null;
  const id = str(o.id);
  if (!id) return null;
  const name = typeof o.name === 'string' && o.name.trim() ? o.name : id;
  const backend = o.backend === 's3' ? 's3' : 'local';
  const localPath = str(o.localPath) ?? str(o.local_path) ?? '';
  return { id, name, backend, localPath };
}

export function parseCloudFoldersResponse(data: unknown): LabCloudFolder[] {
  if (Array.isArray(data)) {
    return data.map(parseCloudFolder).filter((f): f is LabCloudFolder => f !== null);
  }
  const o = asRecord(data);
  if (!o) return [];
  const list = o.cloudFolders ?? o.cloud_folders ?? o.folders ?? o.items ?? o.data;
  if (Array.isArray(list)) {
    return list.map(parseCloudFolder).filter((f): f is LabCloudFolder => f !== null);
  }
  const one = parseCloudFolder(o.cloudFolder ?? o.folder ?? o);
  return one ? [one] : [];
}

export function parseCreatedProject(data: unknown): LabProject | null {
  const o = asRecord(data);
  return parseProject(o?.project ?? data);
}

export function parseCreatedCloudFolder(data: unknown): LabCloudFolder | null {
  const o = asRecord(data);
  return parseCloudFolder(o?.cloudFolder ?? o?.folder ?? data);
}

export function parseFsValidate(data: unknown): FsValidateResult {
  const o = asRecord(data);
  if (!o) return { ok: false, error: '无效响应' };
  const error =
    typeof o.error === 'string'
      ? o.error
      : typeof o.message === 'string'
        ? o.message
        : undefined;
  return {
    ok: o.ok === true,
    realPath: str(o.realPath) ?? str(o.real_path) ?? str(o.path),
    error,
    code: typeof o.code === 'string' ? o.code : undefined
  };
}

/** Parent of an absolute path; undefined at filesystem root or empty. */
export function parentDirOf(path: string): string | undefined {
  const trimmed = path.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed.replace(/[\\/]+$/, '');
  if (!normalized || normalized === '/' || /^[A-Za-z]:$/.test(normalized)) return undefined;
  const idx = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  if (idx < 0) return undefined;
  return idx === 0 ? '/' : normalized.slice(0, idx);
}

function browseEntryKind(r: Record<string, unknown>): 'dir' | 'file' {
  if (r.kind === 'file' || r.isDir === false || r.is_dir === false) return 'file';
  if (r.kind === 'dir' || r.isDir === true || r.is_dir === true) return 'dir';
  return 'dir';
}

export function parseFsBrowse(data: unknown): FsBrowseResult {
  const o = asRecord(data);
  if (!o) return { path: '', entries: [] };
  const path = typeof o.path === 'string' ? o.path : '';
  const entriesRaw = Array.isArray(o.entries) ? o.entries : [];
  const entries: FsBrowseEntry[] = [];
  for (const entry of entriesRaw) {
    const r = asRecord(entry);
    if (!r || typeof r.name !== 'string' || !r.name) continue;
    entries.push({ name: r.name, kind: browseEntryKind(r), path: str(r.path) });
  }
  return {
    path,
    parent: str(o.parent) ?? parentDirOf(path),
    entries
  };
}

export function childBrowsePath(current: string, entry: FsBrowseEntry): string {
  if (entry.path) return entry.path;
  if (!current) return entry.name;
  return `${current.replace(/[\\/]+$/, '')}/${entry.name}`;
}

export function resolveBoundRoots(input: {
  binding: WorkspaceBinding;
  project?: LabProject | null;
  folder?: LabCloudFolder | null;
}): Array<{ path: string; alias?: string }> {
  if (input.binding.kind === 'project') {
    return (input.project?.roots ?? []).map((r) => ({ path: r.path, alias: r.alias }));
  }
  if (input.binding.kind === 'cloud_folder' && input.folder?.localPath) {
    return [{ path: input.folder.localPath, alias: input.folder.name }];
  }
  return [];
}
