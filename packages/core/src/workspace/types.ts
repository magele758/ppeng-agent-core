export const WORKSPACE_KINDS = ['default', 'project', 'cloud_folder'] as const;
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];

export const WORKSPACE_BINDING_BOUND_KEY = 'workspaceBindingBound';

export interface WorkspaceBinding {
  kind: WorkspaceKind;
  projectId?: string;
  cloudFolderId?: string;
}

export interface WorkspaceRootSpec {
  alias: string;
  path: string;
  primary?: boolean;
}

export interface ProjectRootRecord {
  id: string;
  projectId: string;
  alias: string;
  path: string;
  isPrimary: boolean;
}

export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  roots: ProjectRootRecord[];
}

export type CloudFolderBackend = 'local' | 's3';

export interface CloudFolderRecord {
  id: string;
  name: string;
  backend: CloudFolderBackend;
  localPath: string;
  s3Prefix: string;
  createdAt: string;
  updatedAt: string;
}

export interface EffectiveWorkspace {
  kind: WorkspaceKind;
  workspaceRoot: string;
  workspaceRoots: WorkspaceRootSpec[];
  projectId?: string;
  cloudFolderId?: string;
  backend?: CloudFolderBackend;
}

export type WorkspacePathValidationCode =
  | 'not_absolute'
  | 'not_found'
  | 'not_directory'
  | 'symlink'
  | 'blocked'
  | 'not_readable'
  | 'not_writable';

export type WorkspacePathValidationResult =
  | { ok: true; path: string }
  | { ok: false; code: WorkspacePathValidationCode; message: string };
