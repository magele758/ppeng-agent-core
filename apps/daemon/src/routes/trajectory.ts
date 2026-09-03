/**
 * EventLog Trajectory HTTP + Lab KV settings.
 * GET /api/sessions/:id/trajectory — second projection, not Chat hydrate.
 */

import {
  buildTrajectorySnapshot,
  getSessionEventLog,
  hasPersistedEventLogSettings,
  NotFoundError,
  parseTrajectoryQuery,
  readEventLogSettings,
  ValidationError,
  writeEventLogSettings,
  type EventLogSettingsPatch,
  type RawAgentRuntime,
  type TrajectorySnapshot
} from '@ppeng/agent-core';
import type { RouteSpec } from '../routing.js';
import { json } from '../http-utils.js';

export interface TrajectoryHttpBody extends TrajectorySnapshot {
  sessionId: string;
  fromSeq?: number;
  limit?: number;
}

export function trajectoryRoutes(runtime: RawAgentRuntime): RouteSpec[] {
  return [
    {
      method: 'GET',
      pattern: '/api/event-log/settings',
      handler: ({ response }) => {
        const settings = readEventLogSettings(runtime.store);
        json(response, 200, {
          settings,
          effective: {
            enabled: settings.enabled,
            source: hasPersistedEventLogSettings(runtime.store) ? 'ui' : 'default'
          }
        });
      }
    },
    {
      method: 'PATCH',
      pattern: '/api/event-log/settings',
      handler: async ({ readBody, response }) => {
        const body = (await readBody()) as EventLogSettingsPatch & Record<string, unknown>;
        const patch: EventLogSettingsPatch = {};
        if (body && 'enabled' in body) {
          if (typeof body.enabled !== 'boolean') {
            throw new ValidationError('enabled must be a boolean');
          }
          patch.enabled = body.enabled;
        }
        const settings = writeEventLogSettings(runtime.store, patch);
        json(response, 200, {
          settings,
          effective: { enabled: settings.enabled, source: 'ui' as const }
        });
      }
    },
    {
      method: 'GET',
      pattern: '/api/sessions/:id/trajectory',
      handler: ({ requireParam, url, response }) => {
        const id = requireParam('id');
        const session = runtime.getSession(id);
        if (!session) throw new NotFoundError('Session');
        const parsed = parseTrajectoryQuery({
          fromSeq: url.searchParams.get('fromSeq'),
          limit: url.searchParams.get('limit')
        });
        if (!parsed.ok) throw new ValidationError(parsed.error);
        const log = getSessionEventLog(runtime.store, id);
        const snapshot = buildTrajectorySnapshot(log.getEvents(), parsed.query);
        const body: TrajectoryHttpBody = { sessionId: id, turns: snapshot.turns };
        if (parsed.query.fromSeq !== undefined) body.fromSeq = parsed.query.fromSeq;
        if (parsed.query.limit !== undefined) body.limit = parsed.query.limit;
        json(response, 200, body);
      }
    }
  ];
}
