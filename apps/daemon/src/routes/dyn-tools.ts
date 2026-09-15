/**
 * GET/PATCH /api/dyn-tools/settings and session dyn-tool list / promote / retire.
 * Lab UI is the control plane; no new RAW_AGENT_* switch.
 */

import type { RawAgentRuntime } from '@ppeng/agent-core';
import {
  DYN_TOOL_PROMOTE_APPROVAL,
  ValidationError,
  hasPersistedDynToolSettings,
  readDynToolSettings,
  tryCreateDynToolStore,
  writeDynToolSettings,
  type DynToolScope,
  type DynToolSettingsPatch
} from '@ppeng/agent-core';
import type { RouteSpec } from '../routing.js';
import { json } from '../http-utils.js';
import { wrapSessionIdRoutes } from '../session-guard.js';

function dynStoreOf(runtime: RawAgentRuntime) {
  const store = tryCreateDynToolStore(runtime.store);
  if (!store) throw new ValidationError('Dynamic tool store is unavailable');
  return store;
}

export function dynToolRoutes(runtime: RawAgentRuntime): RouteSpec[] {
  return [
    {
      method: 'GET',
      pattern: '/api/dyn-tools/settings',
      handler: ({ response }) => {
        const settings = readDynToolSettings(runtime.store);
        json(response, 200, {
          settings,
          effective: {
            enabled: settings.enabled,
            source: hasPersistedDynToolSettings(runtime.store) ? 'ui' : 'default'
          }
        });
      }
    },
    {
      method: 'PATCH',
      pattern: '/api/dyn-tools/settings',
      handler: async ({ readBody, response }) => {
        const body = (await readBody()) as DynToolSettingsPatch;
        const settings = writeDynToolSettings(runtime.store, body ?? {});
        json(response, 200, {
          settings,
          effective: { enabled: settings.enabled, source: 'ui' as const }
        });
      }
    },
    ...wrapSessionIdRoutes(runtime, [
      {
        method: 'GET',
        pattern: '/api/sessions/:id/dyn-tools',
        handler: ({ requireParam, response }) => {
          const sessionId = requireParam('id');
          const store = dynStoreOf(runtime);
          json(response, 200, { tools: store.list({ sessionId }) });
        }
      },
      {
        method: 'POST',
        pattern: '/api/sessions/:id/dyn-tools/:name/retire',
        handler: ({ requireParam, response }) => {
          const sessionId = requireParam('id');
          const name = requireParam('name');
          const record = dynStoreOf(runtime).retire(name, sessionId);
          json(response, 200, { tool: record });
        }
      },
      {
        method: 'POST',
        pattern: '/api/sessions/:id/dyn-tools/:name/promote',
        handler: async ({ requireParam, readBody, response }) => {
          const sessionId = requireParam('id');
          const name = requireParam('name');
          const body = (await readBody()) as { targetScope?: string };
          const target = body.targetScope;
          if (target !== 'session.long' && target !== 'project.memory') {
            throw new ValidationError('targetScope must be session.long or project.memory');
          }
          const settings = readDynToolSettings(runtime.store);
          if (target === 'project.memory') {
            if (!settings.allowProjectPromote) {
              json(response, 403, { error: 'project.memory promotion is disabled' });
              return;
            }
            const approval = runtime.store.createApproval({
              sessionId,
              toolName: DYN_TOOL_PROMOTE_APPROVAL,
              reason: `Promote dynamic tool ${name} to project.memory`,
              args: { name, targetScope: target },
              idempotencyKey: `dyn-promote:${sessionId}:${name}:project`
            });
            json(response, 202, { pending: true, approval });
            return;
          }
          const record = dynStoreOf(runtime).promote(name, sessionId, target as DynToolScope);
          json(response, 200, { tool: record, pending: false });
        }
      }
    ])
  ];
}
