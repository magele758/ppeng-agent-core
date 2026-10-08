import { ValidationError, type RawAgentRuntime } from '@ppeng/agent-core';
import type { RouteSpec } from '../routing.js';
import { etagFromState, json, sendIfNotModified } from '../http-utils.js';
import { makeSocialPostDeliver } from '../social-schedule-deliver.js';

export function socialRoutes(runtime: RawAgentRuntime, repoRoot: string): RouteSpec[] {
  return [
    {
      method: 'GET',
      pattern: '/api/social-post-schedules',
      handler: ({ request, response }) => {
        if (sendIfNotModified(request, response, etagFromState(runtime.getStateVersion()))) return;
        json(response, 200, { items: runtime.listSocialPostScheduleSummaries() });
      }
    },
    {
      method: 'POST',
      pattern: '/api/social-post-schedules/:taskId/action',
      handler: async ({ requireParam, readBody, response }) => {
        const taskId = requireParam('taskId');
        const body = (await readBody()) as Record<string, unknown>;
        const action = String(body.action ?? '').trim();
        if (action === 'approve' || action === 'reject' || action === 'cancel') {
          const task = runtime.applySocialPostScheduleAction(taskId, action);
          json(response, 200, { task });
          return;
        }
        if (action === 'run_now') {
          const deliver = await makeSocialPostDeliver(repoRoot);
          const task = await runtime.dispatchSocialPostScheduleNow(taskId, deliver);
          json(response, 200, { task });
          return;
        }
        throw new ValidationError('action must be approve, reject, cancel, or run_now');
      }
    }
  ];
}
