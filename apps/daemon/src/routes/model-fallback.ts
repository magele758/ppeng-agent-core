/**
 * Global model fallback chain (Lab "模型备选").
 *   GET   /api/model-fallback/settings   chain + selectable models + per-entry usability
 *   PATCH /api/model-fallback/settings   { chain: [{providerId, modelId}] } — validated, effective immediately
 * Persisted in daemon_control KV; no env switch. Empty chain = off.
 */

import {
  ValidationError,
  modelFallbackPayload,
  writeModelFallbackSettings,
  type ModelRef,
  type RawAgentRuntime
} from '@ppeng/agent-core';
import type { RouteSpec } from '../routing.js';
import { json } from '../http-utils.js';

export function modelFallbackRoutes(runtime: RawAgentRuntime): RouteSpec[] {
  return [
    {
      method: 'GET',
      pattern: '/api/model-fallback/settings',
      handler: ({ response }) => json(response, 200, modelFallbackPayload(runtime.store, process.env))
    },
    {
      method: 'PATCH',
      pattern: '/api/model-fallback/settings',
      handler: async ({ readBody, response }) => {
        const body = (await readBody()) as Record<string, unknown> | null;
        if (!body || typeof body !== 'object' || !('chain' in body)) {
          throw new ValidationError('chain is required');
        }
        writeModelFallbackSettings(runtime.store, { chain: body.chain as ModelRef[] }, process.env);
        json(response, 200, modelFallbackPayload(runtime.store, process.env));
      }
    }
  ];
}
