import { mkdir, rm } from 'node:fs/promises';
import {
  browseLocalDir,
  CloudFolderPersist,
  cloudFolderLocalPath,
  cloudFolderS3Prefix,
  ConflictError,
  NotFoundError,
  parseWorkspaceBinding,
  validateWorkspaceRootPath,
  ValidationError,
  type RawAgentRuntime
} from '@ppeng/agent-core';
import type { RouteSpec } from '../routing.js';
import { json } from '../http-utils.js';

function assertBindingRefs(runtime: RawAgentRuntime, binding: { kind: string; projectId?: string; cloudFolderId?: string }) {
  if (binding.kind === 'project') {
    if (!binding.projectId) throw new ValidationError('projectId is required');
    if (!runtime.store.projects().get(binding.projectId)) {
      throw new NotFoundError('Project', binding.projectId);
    }
  }
  if (binding.kind === 'cloud_folder') {
    if (!binding.cloudFolderId) throw new ValidationError('cloudFolderId is required');
    if (!runtime.store.cloudFolders().get(binding.cloudFolderId)) {
      throw new NotFoundError('Cloud folder', binding.cloudFolderId);
    }
  }
}

export function assertWorkspaceBindingRefs(runtime: RawAgentRuntime, raw: unknown): void {
  const binding = parseWorkspaceBinding(raw);
  if (!binding || binding.kind === 'default') return;
  assertBindingRefs(runtime, binding);
}

export function workspaceRoutes(runtime: RawAgentRuntime): RouteSpec[] {
  return [
    {
      method: 'GET',
      pattern: '/api/projects',
      handler: ({ response }) => {
        json(response, 200, { projects: runtime.store.projects().list() });
      }
    },
    {
      method: 'POST',
      pattern: '/api/projects',
      handler: async ({ readBody, response }) => {
        const body = (await readBody()) as Record<string, unknown>;
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name) throw new ValidationError('name is required');
        const rawRoots = Array.isArray(body.roots) ? body.roots : [];
        const roots: Array<{ path: string; alias?: string; primary?: boolean }> = [];
        for (const item of rawRoots) {
          if (!item || typeof item !== 'object') continue;
          const rec = item as Record<string, unknown>;
          const path = typeof rec.path === 'string' ? rec.path.trim() : '';
          if (!path) continue;
          const checked = await validateWorkspaceRootPath(path);
          if (!checked.ok) throw new ValidationError(checked.message);
          roots.push({
            path: checked.path,
            alias: typeof rec.alias === 'string' ? rec.alias : undefined,
            primary: rec.primary === true
          });
        }
        const project = runtime.store.projects().create({ name, roots });
        json(response, 201, { project });
      }
    },
    {
      method: 'GET',
      pattern: '/api/projects/:id',
      handler: ({ requireParam, response }) => {
        const project = runtime.store.projects().get(requireParam('id'));
        if (!project) throw new NotFoundError('Project');
        json(response, 200, { project });
      }
    },
    {
      method: 'PATCH',
      pattern: '/api/projects/:id',
      handler: async ({ requireParam, readBody, response }) => {
        const body = (await readBody()) as Record<string, unknown>;
        const project = runtime.store.projects().update(requireParam('id'), {
          name: typeof body.name === 'string' ? body.name : undefined,
          primaryRootId: typeof body.primaryRootId === 'string' ? body.primaryRootId : undefined
        });
        if (!project) throw new NotFoundError('Project');
        json(response, 200, { project });
      }
    },
    {
      method: 'DELETE',
      pattern: '/api/projects/:id',
      handler: ({ requireParam, response }) => {
        const ok = runtime.store.projects().remove(requireParam('id'));
        if (!ok) throw new NotFoundError('Project');
        json(response, 200, { ok: true });
      }
    },
    {
      method: 'POST',
      pattern: '/api/projects/:id/roots',
      handler: async ({ requireParam, readBody, response }) => {
        const id = requireParam('id');
        if (!runtime.store.projects().get(id)) throw new NotFoundError('Project');
        const body = (await readBody()) as Record<string, unknown>;
        const path = typeof body.path === 'string' ? body.path.trim() : '';
        if (!path) throw new ValidationError('path is required');
        const checked = await validateWorkspaceRootPath(path);
        if (!checked.ok) throw new ValidationError(checked.message);
        const root = runtime.store.projects().addRoot(id, {
          path: checked.path,
          alias: typeof body.alias === 'string' ? body.alias : undefined,
          primary: body.primary === true
        });
        json(response, 201, { root, project: runtime.store.projects().get(id) });
      }
    },
    {
      method: 'DELETE',
      pattern: '/api/projects/:id/roots/:rootId',
      handler: ({ requireParam, response }) => {
        const id = requireParam('id');
        const rootId = requireParam('rootId');
        if (!runtime.store.projects().get(id)) throw new NotFoundError('Project');
        const ok = runtime.store.projects().removeRoot(id, rootId);
        if (!ok) throw new ConflictError('Cannot remove the last project root');
        json(response, 200, { ok: true, project: runtime.store.projects().get(id) });
      }
    },
    {
      method: 'POST',
      pattern: '/api/fs/validate',
      handler: async ({ readBody, response }) => {
        const body = (await readBody()) as Record<string, unknown>;
        const path = typeof body.path === 'string' ? body.path : '';
        const result = await validateWorkspaceRootPath(path);
        json(response, result.ok ? 200 : 400, result);
      }
    },
    {
      method: 'GET',
      pattern: '/api/fs/browse',
      handler: async ({ url, response }) => {
        const path = url.searchParams.get('path') ?? undefined;
        try {
          const result = await browseLocalDir(path);
          json(response, 200, result);
        } catch (err) {
          throw new ValidationError(err instanceof Error ? err.message : String(err));
        }
      }
    },
    {
      method: 'GET',
      pattern: '/api/cloud-folders',
      handler: ({ response }) => {
        json(response, 200, { folders: runtime.store.cloudFolders().list() });
      }
    },
    {
      method: 'POST',
      pattern: '/api/cloud-folders',
      handler: async ({ readBody, response }) => {
        const body = (await readBody()) as Record<string, unknown>;
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name) throw new ValidationError('name is required');
        const stateDir = runtime.stateDir;
        const store = runtime.store.cloudFolders();
        const persist = CloudFolderPersist.fromEnv();
        const backend = persist.isConfigured() ? 's3' : 'local';
        const folder = store.create({
          name,
          backend,
          localPath: '',
          s3Prefix: ''
        });
        const localPath = cloudFolderLocalPath(stateDir, folder.id);
        const s3Prefix = cloudFolderS3Prefix(folder.id);
        await mkdir(localPath, { recursive: true });
        store.update(folder.id, { localPath, s3Prefix });
        if (backend === 's3') {
          try {
            await persist.writeMarker(folder.id);
          } catch {
            /* fail-soft */
          }
        }
        json(response, 201, { folder: store.get(folder.id) });
      }
    },
    {
      method: 'GET',
      pattern: '/api/cloud-folders/:id',
      handler: ({ requireParam, response }) => {
        const folder = runtime.store.cloudFolders().get(requireParam('id'));
        if (!folder) throw new NotFoundError('Cloud folder');
        json(response, 200, { folder });
      }
    },
    {
      method: 'DELETE',
      pattern: '/api/cloud-folders/:id',
      handler: async ({ requireParam, response }) => {
        const id = requireParam('id');
        const folder = runtime.store.cloudFolders().get(id);
        if (!folder) throw new NotFoundError('Cloud folder');
        runtime.store.cloudFolders().remove(id);
        try {
          await rm(folder.localPath, { recursive: true, force: true });
        } catch {
          /* cache cleanup is best-effort */
        }
        json(response, 200, { ok: true });
      }
    }
  ];
}
