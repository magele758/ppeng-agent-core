import {
  AppError,
  errorMessage,
  NotFoundError,
  type RawAgentRuntime
} from '@ppeng/agent-core';
import type { RouteSpec } from '../routing.js';
import { json } from '../http-utils.js';

export function selfHealRoutes(runtime: RawAgentRuntime): RouteSpec[] {
  return [
    {
      method: 'POST',
      pattern: '/api/self-heal/start',
      handler: async ({ readBody, response }) => {
        const body = (await readBody()) as Record<string, unknown>;
        const policy =
          body.policy && typeof body.policy === 'object' && !Array.isArray(body.policy)
            ? (body.policy as Record<string, unknown>)
            : body;
        try {
          const run = runtime.startSelfHealRun(policy as never);
          json(response, 201, { run });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const code = message.includes('Another self-heal') ? 409 : 400;
          json(response, code, { error: message });
        }
      }
    },
    {
      method: 'GET',
      pattern: '/api/self-heal/status',
      handler: ({ response }) => json(response, 200, { active: runtime.listActiveSelfHealRuns() })
    },
    {
      method: 'GET',
      pattern: '/api/self-heal/runs',
      handler: ({ url, response }) => {
        const limit = Number(url.searchParams.get('limit') ?? '20');
        json(response, 200, { runs: runtime.listSelfHealRuns(Number.isFinite(limit) ? limit : 20) });
      }
    },
    {
      method: 'GET',
      pattern: '/api/self-heal/runs/:runId',
      handler: ({ requireParam, response }) => {
        const runId = requireParam('runId');
        const run = runtime.getSelfHealRun(runId);
        if (!run) throw new NotFoundError('Run');
        json(response, 200, { run });
      }
    },
    {
      method: 'GET',
      pattern: '/api/self-heal/runs/:runId/events',
      handler: ({ requireParam, url, response }) => {
        const runId = requireParam('runId');
        const run = runtime.getSelfHealRun(runId);
        if (!run) throw new NotFoundError('Run');
        const limit = Number(url.searchParams.get('limit') ?? '200');
        json(response, 200, {
          run,
          events: runtime.listSelfHealEvents(runId, Number.isFinite(limit) ? limit : 200)
        });
      }
    },
    {
      method: 'POST',
      pattern: '/api/self-heal/runs/:runId/stop',
      handler: ({ requireParam, response }) => {
        json(response, 200, { run: runtime.stopSelfHealRun(requireParam('runId')) });
      }
    },
    {
      method: 'POST',
      pattern: '/api/self-heal/runs/:runId/resume',
      handler: ({ requireParam, response }) => {
        try {
          json(response, 200, { run: runtime.resumeSelfHealRun(requireParam('runId')) });
        } catch (error) {
          throw error instanceof AppError ? error : new NotFoundError(errorMessage(error));
        }
      }
    }
  ];
}
