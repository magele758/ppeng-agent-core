import {
  readTeamsDagSettings,
  writeTeamsDagSettings,
  type RawAgentRuntime,
  type TeamGateName,
  type TeamsDagSettingsPatch
} from '@ppeng/agent-core';
import type { RouteSpec } from '../routing.js';
import { json } from '../http-utils.js';

const GATES: readonly TeamGateName[] = ['review', 'regression', 'release'];

function asGateName(raw: string): TeamGateName | undefined {
  return (GATES as readonly string[]).includes(raw) ? (raw as TeamGateName) : undefined;
}

export function teamsDagRoutes(runtime: RawAgentRuntime): RouteSpec[] {
  return [
    {
      method: 'GET',
      pattern: '/api/teams/dag/settings',
      handler: ({ response }) => {
        const settings = readTeamsDagSettings(runtime.store);
        json(response, 200, {
          settings,
          effective: {
            source: runtime.store.getDaemonControl('teams_dag_settings') ? 'ui' : 'default'
          }
        });
      }
    },
    {
      method: 'PATCH',
      pattern: '/api/teams/dag/settings',
      handler: async ({ readBody, response }) => {
        const body = (await readBody()) as TeamsDagSettingsPatch;
        const settings = writeTeamsDagSettings(runtime.store, body ?? {});
        json(response, 200, { settings, effective: { source: 'ui' as const } });
      }
    },
    {
      method: 'GET',
      pattern: '/api/teams/plans',
      handler: ({ url, response }) => {
        const sessionId = url.searchParams.get('sessionId') ?? undefined;
        const status = url.searchParams.get('status') as
          | 'drafting'
          | 'running'
          | 'paused'
          | 'completed'
          | 'failed'
          | 'cancelled'
          | null;
        const plans = runtime.store.teams().list({
          sessionId,
          status: status ?? undefined,
          limit: 50
        });
        json(response, 200, { plans });
      }
    },
    {
      method: 'POST',
      pattern: '/api/teams/plans',
      handler: async ({ readBody, response }) => {
        const body = (await readBody()) as Record<string, unknown>;
        const objective = typeof body.objective === 'string' ? body.objective.trim() : '';
        if (!objective) {
          json(response, 400, { error: 'objective is required' });
          return;
        }
        const created = await runtime.createTeamPlan({
          objective,
          sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
          tasks: body.tasks
        });
        if (created.error || !created.plan) {
          json(response, 400, { error: created.error ?? 'invalid plan' });
          return;
        }
        json(response, 201, { plan: created.plan });
      }
    },
    {
      method: 'GET',
      pattern: '/api/teams/plans/:id',
      handler: ({ requireParam, response }) => {
        const plan = runtime.store.teams().get(requireParam('id'));
        if (!plan) {
          json(response, 404, { error: 'Team plan not found' });
          return;
        }
        const reviews = runtime.store.teams().listReviews(plan.id);
        const mailbox = runtime.listTeamMailbox(plan.id, 50);
        json(response, 200, { plan, reviews, mailbox });
      }
    },
    {
      method: 'POST',
      pattern: '/api/teams/plans/:id/start',
      handler: ({ requireParam, response }) => {
        const plan = runtime.startTeamPlan(requireParam('id'));
        if (!plan) {
          json(response, 409, { error: 'Plan not found or not startable' });
          return;
        }
        void runtime.runScheduler();
        json(response, 200, { plan });
      }
    },
    {
      method: 'POST',
      pattern: '/api/teams/plans/:id/resume',
      handler: ({ requireParam, response }) => {
        const plan = runtime.resumeTeamPlan(requireParam('id'));
        if (!plan) {
          json(response, 404, { error: 'Plan not found' });
          return;
        }
        void runtime.runScheduler();
        json(response, 200, { plan });
      }
    },
    {
      method: 'POST',
      pattern: '/api/teams/plans/:id/gates/:gate/decide',
      handler: async ({ requireParam, readBody, response }) => {
        const gate = asGateName(requireParam('gate'));
        if (!gate) {
          json(response, 400, { error: 'gate must be review | regression | release' });
          return;
        }
        const body = (await readBody()) as Record<string, unknown>;
        const passed = body.passed !== false;
        const feedback = typeof body.feedback === 'string' ? body.feedback : undefined;
        try {
          const plan = runtime.decideTeamGate(requireParam('id'), gate, passed, feedback);
          if (!plan) {
            json(response, 404, { error: 'Team plan not found' });
            return;
          }
          void runtime.runScheduler();
          json(response, 200, { plan });
        } catch (e) {
          json(response, 409, { error: e instanceof Error ? e.message : String(e) });
        }
      }
    }
  ];
}
