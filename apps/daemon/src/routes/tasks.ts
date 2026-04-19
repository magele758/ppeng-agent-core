import { NotFoundError, type RawAgentRuntime } from '@ppeng/agent-core';
import type { RouteSpec } from '../routing.js';
import { etagFromState, json, sendIfNotModified } from '../http-utils.js';

function imageAssetIdsFromBody(body: Record<string, unknown>): string[] {
  if (!Array.isArray(body.imageAssetIds)) return [];
  return body.imageAssetIds.map(String).filter(Boolean);
}

export function tasksRoutes(runtime: RawAgentRuntime): RouteSpec[] {
  return [
    {
      method: 'GET',
      pattern: '/api/tasks',
      handler: ({ request, response }) => {
        if (sendIfNotModified(request, response, etagFromState(runtime.getStateVersion()))) return;
        json(response, 200, { tasks: runtime.listTasks() });
      }
    },
    {
      method: 'POST',
      pattern: '/api/tasks',
      handler: async ({ readBody, response }) => {
        const body = (await readBody()) as Record<string, unknown>;
        const result = runtime.createTaskSession({
          title: String(body.title ?? body.goal ?? 'Task'),
          description: typeof body.description === 'string' ? body.description : undefined,
          message: typeof body.message === 'string'
            ? body.message
            : typeof body.goal === 'string' ? body.goal : undefined,
          imageAssetIds: imageAssetIdsFromBody(body),
          agentId: typeof body.agentId === 'string' ? body.agentId : undefined,
          blockedBy: Array.isArray(body.blockedBy) ? body.blockedBy.map(String) : undefined,
          background: body.background !== false
        });
        if (body.autoRun !== false) await runtime.runSession(result.session.id);
        json(response, 201, {
          task: runtime.getTask(result.task.id),
          session: runtime.getSession(result.session.id),
          latestAssistant: runtime.getLatestAssistantText(result.session.id)
        });
      }
    },
    {
      method: 'GET',
      pattern: '/api/tasks/:id',
      handler: ({ requireParam, response }) => {
        const id = requireParam('id');
        const task = runtime.getTask(id);
        if (!task) throw new NotFoundError('Task');
        json(response, 200, {
          task,
          events: runtime.getTaskEvents(id),
          session: task.sessionId ? runtime.getSession(task.sessionId) : undefined
        });
      }
    }
  ];
}
