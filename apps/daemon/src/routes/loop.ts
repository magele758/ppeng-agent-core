/**
 * Agent-loop Lab settings HTTP API.
 * GET/PATCH /api/loop/settings — persist immediately in daemon_control KV.
 */

import type { RawAgentRuntime } from '@ppeng/agent-core';
import { ValidationError } from '@ppeng/agent-core';
import type { RouteSpec } from '../routing.js';
import { json } from '../http-utils.js';
import {
  hasPersistedLoopSettings,
  loopSettingsAsRuntimeHint,
  parseSteerDrainPolicy,
  readLoopSettings,
  writeLoopSettings,
  type LoopSettingsPatch
} from '../loop-settings.js';

export function loopRoutes(runtime: RawAgentRuntime): RouteSpec[] {
  return [
    {
      method: 'GET',
      pattern: '/api/loop/settings',
      handler: ({ response }) => {
        const settings = readLoopSettings(runtime.store);
        json(response, 200, {
          settings,
          // TODO(Phase 3 A3): prepareTurnInput does not yet honor tool_launch drain.
          // KV is the source of truth; runtime hint is recorded for that wiring.
          runtimeHint: loopSettingsAsRuntimeHint(settings),
          effective: {
            steerDrainPolicy: settings.steerDrainPolicy,
            source: hasPersistedLoopSettings(runtime.store) ? 'ui' : 'default'
          }
        });
      }
    },
    {
      method: 'PATCH',
      pattern: '/api/loop/settings',
      handler: async ({ readBody, response }) => {
        const body = (await readBody()) as LoopSettingsPatch & Record<string, unknown>;
        const patch: LoopSettingsPatch = {};
        if (body && 'steerDrainPolicy' in body) {
          const parsed = parseSteerDrainPolicy(body.steerDrainPolicy);
          if (!parsed) {
            throw new ValidationError('steerDrainPolicy must be next_shot_only or tool_launch');
          }
          patch.steerDrainPolicy = parsed;
        }
        const settings = writeLoopSettings(runtime.store, patch);
        json(response, 200, {
          settings,
          runtimeHint: loopSettingsAsRuntimeHint(settings),
          effective: {
            steerDrainPolicy: settings.steerDrainPolicy,
            source: 'ui' as const
          }
        });
      }
    }
  ];
}
