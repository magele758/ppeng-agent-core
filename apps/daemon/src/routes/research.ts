import {
  NotFoundError,
  ResearchStore,
  type RawAgentRuntime,
  type ResearchStatus,
  type SourceKind,
  type TrustLevel,
  type ClaimConfidence
} from '@ppeng/agent-core';
import type { RouteSpec } from '../routing.js';
import { json } from '../http-utils.js';

export function researchRoutes(runtime: RawAgentRuntime): RouteSpec[] {
  const store = new ResearchStore(runtime.store.db);

  return [
    {
      method: 'GET',
      pattern: '/api/research/tasks',
      handler: ({ url, response }) => {
        const status = url.searchParams.get('status') as ResearchStatus | null;
        const limit = Number(url.searchParams.get('limit') ?? 100);
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const tasks = store.listTasks({
          status: status ?? undefined,
          limit: Number.isFinite(limit) ? limit : 100,
          offset: Number.isFinite(offset) ? offset : 0
        });
        json(response, 200, { tasks });
      }
    },
    {
      method: 'POST',
      pattern: '/api/research/tasks',
      handler: async ({ readBody, response }) => {
        const body = (await readBody()) as Record<string, unknown>;
        const task = store.createTask({
          query: String(body.query ?? ''),
          scope: typeof body.scope === 'string' ? body.scope : undefined,
          capabilityTags: Array.isArray(body.capabilityTags)
            ? (body.capabilityTags as string[])
            : undefined
        });
        json(response, 201, { task });
      }
    },
    {
      method: 'GET',
      pattern: '/api/research/tasks/:id',
      handler: ({ requireParam, response }) => {
        const id = requireParam('id');
        const task = store.getTask(id);
        if (!task) throw new NotFoundError('ResearchTask', id);
        json(response, 200, { task });
      }
    },
    {
      method: 'PATCH',
      pattern: '/api/research/tasks/:id/status',
      handler: async ({ requireParam, readBody, response }) => {
        const id = requireParam('id');
        const body = (await readBody()) as Record<string, unknown>;
        const status = String(body.status ?? '') as ResearchStatus;
        const task = store.updateTaskStatus(id, status);
        json(response, 200, { task });
      }
    },
    {
      method: 'GET',
      pattern: '/api/research/tasks/:id/sources',
      handler: ({ requireParam, response }) => {
        const id = requireParam('id');
        const sources = store.listSources(id);
        json(response, 200, { sources });
      }
    },
    {
      method: 'POST',
      pattern: '/api/research/tasks/:id/sources',
      handler: async ({ requireParam, readBody, response }) => {
        const taskId = requireParam('id');
        if (!store.getTask(taskId)) throw new NotFoundError('ResearchTask', taskId);
        const body = (await readBody()) as Record<string, unknown>;
        const source = store.addSource({
          taskId,
          kind: typeof body.kind === 'string' ? (body.kind as SourceKind) : 'web',
          url: typeof body.url === 'string' ? body.url : undefined,
          title: String(body.title ?? ''),
          fetchedAt: typeof body.fetchedAt === 'string' ? body.fetchedAt : new Date().toISOString(),
          trustLevel: typeof body.trustLevel === 'string' ? (body.trustLevel as TrustLevel) : 'unknown'
        });
        json(response, 201, { source });
      }
    },
    {
      method: 'GET',
      pattern: '/api/research/tasks/:id/evidence',
      handler: ({ requireParam, response }) => {
        const id = requireParam('id');
        const evidence = store.listEvidence(id);
        json(response, 200, { evidence });
      }
    },
    {
      method: 'POST',
      pattern: '/api/research/tasks/:id/evidence',
      handler: async ({ requireParam, readBody, response }) => {
        const taskId = requireParam('id');
        if (!store.getTask(taskId)) throw new NotFoundError('ResearchTask', taskId);
        const body = (await readBody()) as Record<string, unknown>;
        const evidence = store.addEvidence({
          taskId,
          sourceId: String(body.sourceId ?? ''),
          quote: String(body.quote ?? ''),
          location: typeof body.location === 'string' ? body.location : undefined,
          relevance: typeof body.relevance === 'number' ? body.relevance : 0.5
        });
        json(response, 201, { evidence });
      }
    },
    {
      method: 'GET',
      pattern: '/api/research/tasks/:id/claims',
      handler: ({ requireParam, response }) => {
        const id = requireParam('id');
        const claims = store.listClaims(id);
        json(response, 200, { claims });
      }
    },
    {
      method: 'POST',
      pattern: '/api/research/tasks/:id/claims',
      handler: async ({ requireParam, readBody, response }) => {
        const taskId = requireParam('id');
        if (!store.getTask(taskId)) throw new NotFoundError('ResearchTask', taskId);
        const body = (await readBody()) as Record<string, unknown>;
        const claim = store.addClaim({
          taskId,
          text: String(body.text ?? ''),
          confidence: typeof body.confidence === 'string'
            ? (body.confidence as ClaimConfidence)
            : 'medium',
          evidenceIds: Array.isArray(body.evidenceIds) ? (body.evidenceIds as string[]) : [],
          caveats: Array.isArray(body.caveats) ? (body.caveats as string[]) : undefined
        });
        json(response, 201, { claim });
      }
    }
  ];
}
