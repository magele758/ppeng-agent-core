import {
  canAccessSession,
  goalWirePayload,
  readGoalSettings,
  resumeGoalOnUserReply,
  tryGoalStore,
  upsertGoalFromApi,
  writeGoalSettings,
  type GoalSettingsPatch,
  type GoalStatusValue,
  type RawAgentRuntime
} from '@ppeng/agent-core';
import type { RouteSpec } from '../routing.js';
import { json } from '../http-utils.js';
import { guardSession, wrapSessionIdRoutes } from '../session-guard.js';

export function goalRoutes(runtime: RawAgentRuntime): RouteSpec[] {
  return wrapSessionIdRoutes(runtime, [
    {
      method: 'GET',
      pattern: '/api/goals/settings',
      handler: ({ response }) => {
        const settings = readGoalSettings(runtime.store);
        json(response, 200, {
          settings,
          effective: {
            source: runtime.store.getDaemonControl('goal_settings') ? 'ui' : 'default'
          }
        });
      }
    },
    {
      method: 'PATCH',
      pattern: '/api/goals/settings',
      handler: async ({ readBody, response }) => {
        const body = (await readBody()) as GoalSettingsPatch;
        const settings = writeGoalSettings(runtime.store, body ?? {});
        json(response, 200, { settings, effective: { source: 'ui' as const } });
      }
    },
    {
      method: 'GET',
      pattern: '/api/goals',
      handler: ({ url, response, auth }) => {
        const store = runtime.store.goal();
        const sessionId = url.searchParams.get('sessionId');
        const status = url.searchParams.get('status') as GoalStatusValue | null;
        if (sessionId) {
          guardSession(runtime, sessionId, auth);
          json(response, 200, { goals: store.listBySession(sessionId) });
          return;
        }
        const goals = store.list({ status: status ?? undefined, limit: 50 }).filter((goal) => {
          if (!auth.isolate) return true;
          const session = runtime.getSession(goal.sessionId);
          return Boolean(session && canAccessSession(session, auth));
        });
        json(response, 200, { goals });
      }
    },
    {
      method: 'POST',
      pattern: '/api/goals',
      handler: async ({ readBody, response, auth }) => {
        const body = (await readBody()) as Record<string, unknown>;
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
        const condition = typeof body.condition === 'string' ? body.condition.trim() : '';
        if (!sessionId || !condition) {
          json(response, 400, { error: 'sessionId and condition are required' });
          return;
        }
        guardSession(runtime, sessionId, auth);
        const rec = upsertGoalFromApi(runtime.store.goal(), {
          sessionId,
          condition,
          maxTurns: typeof body.maxTurns === 'number' ? body.maxTurns : undefined,
          verify: body.verify,
          criteria: Array.isArray(body.criteria) ? body.criteria.map(String) : undefined
        });
        runtime.mergeSessionMetadata(sessionId, {
          goalCondition: rec.condition,
          goalEnabled: true,
          goalMaxTurns: rec.maxTurns
        });
        json(response, 201, { goal: goalWirePayload(rec) });
      }
    },
    {
      method: 'GET',
      pattern: '/api/goals/:id',
      handler: ({ requireParam, response, auth }) => {
        const rec = runtime.store.goal().get(requireParam('id'));
        if (!rec) {
          json(response, 404, { error: 'Goal not found' });
          return;
        }
        guardSession(runtime, rec.sessionId, auth);
        json(response, 200, { goal: goalWirePayload(rec) });
      }
    },
    {
      method: 'GET',
      pattern: '/api/sessions/:id/goal',
      handler: ({ requireParam, response }) => {
        const id = requireParam('id');
        if (!runtime.getSession(id)) {
          json(response, 404, { error: 'Session not found' });
          return;
        }
        const rec = runtime.store.goal().findLatestBySession(id);
        json(response, 200, { goal: goalWirePayload(rec) });
      }
    },
    {
      method: 'POST',
      pattern: '/api/sessions/:id/ask-user/reply',
      handler: async ({ requireParam, readBody, response }) => {
        const id = requireParam('id');
        const session = runtime.getSession(id);
        if (!session) {
          json(response, 404, { error: 'Session not found' });
          return;
        }
        const body = (await readBody()) as Record<string, unknown>;
        const reply = typeof body.reply === 'string' ? body.reply.trim() : '';
        if (!reply) {
          json(response, 400, { error: 'reply is required' });
          return;
        }
        runtime.mergeSessionMetadata(id, { askUserReply: reply, askUserPending: false });
        resumeGoalOnUserReply(tryGoalStore(runtime.store), id);
        json(response, 200, { ok: true, reply });
      }
    }
  ]);
}
