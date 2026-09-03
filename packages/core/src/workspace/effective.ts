import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { SessionRecord } from '../types.js';
import { workspaceBindingFromMetadata } from './binding.js';
import { CloudFolderPersist, cloudFolderLocalPath } from './cloud-persist.js';
import type { CloudFolderStore } from './cloud-store.js';
import { WorkspaceUnavailableError } from './errors.js';
import type { ProjectStore } from './project-store.js';
import { defaultWorkspaceRoots } from './resolve.js';
import { validateWorkspaceRootPath } from './validate.js';
import type { EffectiveWorkspace, WorkspaceRootSpec } from './types.js';

export interface WorkspaceStoreHost {
  projects(): ProjectStore;
  cloudFolders(): CloudFolderStore;
}

export interface ResolveEffectiveWorkspaceInput {
  store: WorkspaceStoreHost;
  session: Pick<SessionRecord, 'metadata'>;
  repoRoot: string;
  stateDir: string;
  isolatedWorkspaceRoot?: string;
  persist?: CloudFolderPersist;
  env?: NodeJS.ProcessEnv;
}

export async function resolveEffectiveWorkspace(
  input: ResolveEffectiveWorkspaceInput
): Promise<EffectiveWorkspace> {
  const binding = workspaceBindingFromMetadata(input.session.metadata);
  if (binding.kind === 'project') {
    return resolveProjectWorkspace(input, binding.projectId!);
  }
  if (binding.kind === 'cloud_folder') {
    return resolveCloudWorkspace(input, binding.cloudFolderId!);
  }
  const root = input.isolatedWorkspaceRoot;
  return {
    kind: 'default',
    workspaceRoot: root ?? input.repoRoot,
    workspaceRoots: defaultWorkspaceRoots(root, input.repoRoot)
  };
}

async function resolveProjectWorkspace(
  input: ResolveEffectiveWorkspaceInput,
  projectId: string
): Promise<EffectiveWorkspace> {
  const project = input.store.projects().get(projectId);
  if (!project) {
    throw new WorkspaceUnavailableError(`Project not found: ${projectId}`, {
      kind: 'project',
      projectId
    });
  }
  if (!project.roots.length) {
    throw new WorkspaceUnavailableError(`Project ${project.name} has no roots`, {
      kind: 'project',
      projectId
    });
  }
  const roots: WorkspaceRootSpec[] = [];
  for (const root of project.roots) {
    const checked = await validateWorkspaceRootPath(root.path);
    if (!checked.ok) {
      throw new WorkspaceUnavailableError(
        `Project root @${root.alias} is unavailable (${checked.code}): ${root.path}`,
        { kind: 'project', projectId, alias: root.alias, path: root.path, code: checked.code }
      );
    }
    roots.push({ alias: root.alias, path: checked.path, primary: root.isPrimary });
  }
  const primary = roots.find((r) => r.primary) ?? roots[0]!;
  return {
    kind: 'project',
    workspaceRoot: primary.path,
    workspaceRoots: roots,
    projectId
  };
}

async function resolveCloudWorkspace(
  input: ResolveEffectiveWorkspaceInput,
  cloudFolderId: string
): Promise<EffectiveWorkspace> {
  const folder = input.store.cloudFolders().get(cloudFolderId);
  if (!folder) {
    throw new WorkspaceUnavailableError(`Cloud folder not found: ${cloudFolderId}`, {
      kind: 'cloud_folder',
      cloudFolderId
    });
  }
  const localPath = folder.localPath || cloudFolderLocalPath(input.stateDir, folder.id);
  const persist = input.persist ?? CloudFolderPersist.fromEnv(input.env);
  if (folder.backend === 's3' && persist.isConfigured()) {
    try {
      await persist.hydrate(folder.id, localPath);
    } catch {
      /* fail-soft; local cache may already be usable */
    }
  }
  if (!existsSync(localPath)) {
    if (folder.backend === 'local' || !persist.isConfigured()) {
      throw new WorkspaceUnavailableError(`Cloud folder cache is missing: ${localPath}`, {
        kind: 'cloud_folder',
        cloudFolderId,
        path: localPath
      });
    }
    throw new WorkspaceUnavailableError(`Cloud folder is unavailable: ${folder.name}`, {
      kind: 'cloud_folder',
      cloudFolderId,
      path: localPath
    });
  }
  const checked = await validateWorkspaceRootPath(localPath);
  if (!checked.ok) {
    throw new WorkspaceUnavailableError(
      `Cloud folder cache is unavailable (${checked.code}): ${localPath}`,
      { kind: 'cloud_folder', cloudFolderId, path: localPath, code: checked.code }
    );
  }
  return {
    kind: 'cloud_folder',
    workspaceRoot: checked.path,
    workspaceRoots: [{ alias: 'cloud', path: checked.path, primary: true }],
    cloudFolderId,
    backend: folder.backend
  };
}

export async function ensureCloudFolderCache(localPath: string): Promise<void> {
  await mkdir(localPath, { recursive: true });
}
