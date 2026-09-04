/**
 * GET/PATCH /api/skills/settings — persist immediately in daemon_control KV.
 * Lab UI is the control plane; no new RAW_AGENT_* disclosure switch.
 */

import type { RawAgentRuntime } from '@ppeng/agent-core';
import {
  ValidationError,
  hasPersistedSkillSettings,
  parseSkillDisclosureMode,
  readSkillSettings,
  resolveSkillDisclosureMode,
  writeSkillSettings,
  type SkillSettingsPatch
} from '@ppeng/agent-core';
import type { RouteSpec } from '../routing.js';
import { json } from '../http-utils.js';

export function skillSettingsRoutes(runtime: RawAgentRuntime): RouteSpec[] {
  return [
    {
      method: 'GET',
      pattern: '/api/skills/settings',
      handler: ({ response }) => {
        const settings = readSkillSettings(runtime.store);
        const disclosureMode = resolveSkillDisclosureMode({
          store: runtime.store,
          env: process.env
        });
        json(response, 200, {
          settings,
          effective: {
            disclosureMode,
            source: hasPersistedSkillSettings(runtime.store) ? 'ui' : 'default'
          }
        });
      }
    },
    {
      method: 'PATCH',
      pattern: '/api/skills/settings',
      handler: async ({ readBody, response }) => {
        const body = (await readBody()) as SkillSettingsPatch & Record<string, unknown>;
        const patch: SkillSettingsPatch = {};
        if (body && 'disclosureMode' in body) {
          const parsed = parseSkillDisclosureMode(body.disclosureMode);
          if (!parsed) {
            throw new ValidationError('disclosureMode must be shortlist, lazy, or full');
          }
          patch.disclosureMode = parsed;
        }
        const settings = writeSkillSettings(runtime.store, patch);
        json(response, 200, {
          settings,
          effective: {
            disclosureMode: settings.disclosureMode,
            source: 'ui' as const
          }
        });
      }
    }
  ];
}
