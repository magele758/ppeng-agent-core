/**
 * GET/PATCH /api/jev/settings — Lab KV. No chain unless an entry is saved and enabled.
 * POST /api/jev/probe — connectivity check; does not turn the chain on.
 */

import {
  publicJevSettings,
  readJevSettings,
  writeJevSettings,
  askJev,
  noulOf,
  type JevChain,
  type JevSettingsPatch,
  type RawAgentRuntime
} from '@ppeng/agent-core';
import type { RouteSpec } from '../routing.js';
import { json } from '../http-utils.js';

export function jevRoutes(runtime: RawAgentRuntime): RouteSpec[] {
  return [
    {
      method: 'GET',
      pattern: '/api/jev/settings',
      handler: ({ response }) => {
        const settings = publicJevSettings(readJevSettings(runtime.store), process.env);
        json(response, 200, {
          settings,
          effective: { source: runtime.store.getDaemonControl('jev_settings') ? 'ui' : 'default' }
        });
      }
    },
    {
      method: 'PATCH',
      pattern: '/api/jev/settings',
      handler: async ({ readBody, response }) => {
        const body = (await readBody()) as JevSettingsPatch;
        const saved = writeJevSettings(runtime.store, body ?? {});
        json(response, 200, {
          settings: publicJevSettings(saved, process.env),
          effective: { source: 'ui' as const }
        });
      }
    },
    {
      method: 'POST',
      pattern: '/api/jev/probe',
      handler: async ({ readBody, response }) => {
        const body = (await readBody()) as JevSettingsPatch;
        const saved = readJevSettings(runtime.store);
        const baseUrl = (typeof body?.baseUrl === 'string' ? body.baseUrl : saved.baseUrl).trim().replace(/\/+$/, '');
        if (!baseUrl) {
          json(response, 200, { ok: false, error: 'baseUrl required' });
          return;
        }
        const apiKey =
          typeof body?.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : saved.apiKey;
        const chain: JevChain = {
          baseUrl,
          apiKey:
            apiKey ||
            process.env.TYPESAFE_API_KEY ||
            process.env.TYPESAFE_AI_API_KEY ||
            process.env.JEV_API_KEY ||
            '',
          model: typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : saved.model,
          points: [],
          modules: {
            goalGate: false,
            toolGate: false,
            compact: false,
            route: false,
            contextSelect: false,
            toolSelect: false,
            skillSelect: false,
            sagaGate: false,
            memorySelect: false,
            recoveryChoice: false,
            preTurn: false,
            ptcDecide: false
          }
        };
        const answers = await askJev({
          chain,
          state: 'probe',
          nouls: [{ id: 'probe', instructions: 'Is this a connectivity probe?' }]
        });
        json(response, 200, { ok: noulOf(answers, 'probe') != null });
      }
    }
  ];
}
