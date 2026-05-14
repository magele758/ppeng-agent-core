import {
  SwarmStore,
  createSwarmId,
  nowIso,
  type RawAgentRuntime,
  type SwarmStatus,
  type SwarmStrategy,
  type SwarmRole,
  type SwarmTaskStatus,
  type SwarmBudget
} from '@ppeng/agent-core';
import type { RouteSpec } from '../routing.js';
import { json } from '../http-utils.js';

export function swarmRoutes(runtime: RawAgentRuntime): RouteSpec[] {
  const store = new SwarmStore(runtime.store.db);

  return [
    // ── SwarmRun ────────────────────────────────────────────────────────────
    {
      method: 'GET',
      pattern: '/api/swarm/runs',
      handler: ({ url, response }) => {
        const status = url.searchParams.get('status') as SwarmStatus | null;
        const limit = Number(url.searchParams.get('limit') ?? 100);
        const runs = store.listRuns({
          status: status ?? undefined,
          limit: Number.isFinite(limit) ? limit : 100
        });
        json(response, 200, { runs });
      }
    },
    {
      method: 'POST',
      pattern: '/api/swarm/runs',
      handler: async ({ readBody, response }) => {
        const body = (await readBody()) as Record<string, unknown>;
        const defaultBudget: SwarmBudget = {
          maxTeammates: 3,
          maxTurnsPerAgent: 20,
          maxDurationMs: 600_000
        };
        const run = {
          id: createSwarmId('srun'),
          goal: String(body.goal ?? ''),
          orchestrationRunId:
            typeof body.orchestrationRunId === 'string' ? body.orchestrationRunId : undefined,
          status: 'pending' as SwarmStatus,
          strategy: (typeof body.strategy === 'string'
            ? body.strategy
            : 'pipeline') as SwarmStrategy,
          budget:
            typeof body.budget === 'object' && body.budget != null
              ? (body.budget as SwarmBudget)
              : defaultBudget,
          qualityGate: Array.isArray(body.qualityGate) ? (body.qualityGate as string[]) : [],
          createdAt: nowIso(),
          updatedAt: nowIso()
        };
        store.createRun(run);
        json(response, 201, { run });
      }
    },
    {
      method: 'GET',
      pattern: '/api/swarm/runs/:id',
      handler: ({ requireParam, response }) => {
        const id = requireParam('id');
        const run = store.getRun(id);
        if (!run) {
          json(response, 404, { error: `SwarmRun ${id} not found` });
          return;
        }
        const tasks = store.listTasks(id);
        const reviews = store.listReviews(id);
        json(response, 200, { run, tasks, reviews });
      }
    },
    {
      method: 'PATCH',
      pattern: '/api/swarm/runs/:id/status',
      handler: async ({ requireParam, readBody, response }) => {
        const id = requireParam('id');
        const run = store.getRun(id);
        if (!run) {
          json(response, 404, { error: `SwarmRun ${id} not found` });
          return;
        }
        const body = (await readBody()) as Record<string, unknown>;
        const status = String(body.status ?? '') as SwarmStatus;
        store.updateRunStatus(id, status);
        json(response, 200, { run: { ...run, status } });
      }
    },

    // ── SwarmTask ───────────────────────────────────────────────────────────
    {
      method: 'GET',
      pattern: '/api/swarm/runs/:id/tasks',
      handler: ({ requireParam, url, response }) => {
        const id = requireParam('id');
        const status = url.searchParams.get('status') as SwarmTaskStatus | null;
        const role = url.searchParams.get('role') as SwarmRole | null;
        const tasks = store.listTasks(id, {
          status: status ?? undefined,
          role: role ?? undefined
        });
        json(response, 200, { tasks });
      }
    },
    {
      method: 'POST',
      pattern: '/api/swarm/runs/:id/tasks',
      handler: async ({ requireParam, readBody, response }) => {
        const swarmRunId = requireParam('id');
        const run = store.getRun(swarmRunId);
        if (!run) {
          json(response, 404, { error: `SwarmRun ${swarmRunId} not found` });
          return;
        }
        const body = (await readBody()) as Record<string, unknown>;
        const task = {
          id: createSwarmId('stask'),
          swarmRunId,
          title: String(body.title ?? 'Untitled task'),
          description: typeof body.description === 'string' ? body.description : undefined,
          status: 'pending' as SwarmTaskStatus,
          requiredRole: (typeof body.requiredRole === 'string'
            ? body.requiredRole
            : 'implementer') as SwarmRole,
          ownerAgentId: typeof body.ownerAgentId === 'string' ? body.ownerAgentId : undefined,
          capabilityTags: Array.isArray(body.capabilityTags)
            ? (body.capabilityTags as string[])
            : [],
          acceptanceCriteria: Array.isArray(body.acceptanceCriteria)
            ? (body.acceptanceCriteria as string[])
            : [],
          artifacts: Array.isArray(body.artifacts) ? (body.artifacts as string[]) : [],
          blockedBy: Array.isArray(body.blockedBy) ? (body.blockedBy as string[]) : [],
          budget:
            typeof body.budget === 'object' && body.budget != null
              ? (body.budget as { maxTurns?: number })
              : undefined,
          createdAt: nowIso(),
          updatedAt: nowIso()
        };
        store.createTask(task);
        json(response, 201, { task });
      }
    },
    {
      method: 'PATCH',
      pattern: '/api/swarm/tasks/:taskId/status',
      handler: async ({ requireParam, readBody, response }) => {
        const taskId = requireParam('taskId');
        const task = store.getTask(taskId);
        if (!task) {
          json(response, 404, { error: `SwarmTask ${taskId} not found` });
          return;
        }
        const body = (await readBody()) as Record<string, unknown>;
        const status = String(body.status ?? '') as SwarmTaskStatus;
        store.updateTask(taskId, { status });
        json(response, 200, { task: { ...task, status } });
      }
    },
    {
      method: 'POST',
      pattern: '/api/swarm/tasks/:taskId/claim',
      handler: async ({ requireParam, readBody, response }) => {
        const taskId = requireParam('taskId');
        const body = (await readBody()) as Record<string, unknown>;
        const agentId = String(body.agentId ?? '');
        if (!agentId) {
          json(response, 400, { error: 'agentId is required' });
          return;
        }
        const claimed = store.claimTask(taskId, agentId);
        if (!claimed) {
          json(response, 409, { error: 'Task already claimed or not found' });
          return;
        }
        const task = store.getTask(taskId);
        json(response, 200, { task });
      }
    },

    // ── SwarmReview ─────────────────────────────────────────────────────────
    {
      method: 'GET',
      pattern: '/api/swarm/runs/:id/reviews',
      handler: ({ requireParam, response }) => {
        const id = requireParam('id');
        const reviews = store.listReviews(id);
        json(response, 200, { reviews });
      }
    },
    {
      method: 'POST',
      pattern: '/api/swarm/runs/:id/reviews',
      handler: async ({ requireParam, readBody, response }) => {
        const swarmRunId = requireParam('id');
        const run = store.getRun(swarmRunId);
        if (!run) {
          json(response, 404, { error: `SwarmRun ${swarmRunId} not found` });
          return;
        }
        const body = (await readBody()) as Record<string, unknown>;
        const review = {
          id: createSwarmId('srev'),
          swarmRunId,
          taskId: String(body.taskId ?? ''),
          reviewerAgentId: String(body.reviewerAgentId ?? ''),
          role: (typeof body.role === 'string' ? body.role : 'reviewer') as SwarmRole,
          scores:
            typeof body.scores === 'object' && body.scores != null
              ? (body.scores as Record<string, number>)
              : {},
          passed: Boolean(body.passed),
          feedback: String(body.feedback ?? ''),
          createdAt: nowIso()
        };
        store.addReview(review);
        json(response, 201, { review });
      }
    }
  ];
}
