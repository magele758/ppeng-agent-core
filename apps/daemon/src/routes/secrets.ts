/**
 * Lab secret references: names only on the wire. Values stay in daemon_control KV.
 */

import { NotFoundError, ValidationError, type RawAgentRuntime } from '@ppeng/agent-core';
import type { RouteSpec } from '../routing.js';
import { json } from '../http-utils.js';

export function secretsRoutes(runtime: RawAgentRuntime): RouteSpec[] {
  return [
    {
      method: 'GET',
      pattern: '/api/secrets',
      handler: ({ response }) => {
        json(response, 200, { secrets: runtime.secretVault.list() });
      }
    },
    {
      method: 'PUT',
      pattern: '/api/secrets/:name',
      handler: async ({ requireParam, readBody, response }) => {
        const name = requireParam('name');
        const body = (await readBody()) as Record<string, unknown>;
        const value = typeof body.value === 'string' ? body.value : '';
        if (!value) throw new ValidationError('value is required');
        try {
          runtime.secretVault.set(name, value);
        } catch (err) {
          throw new ValidationError(err instanceof Error ? err.message : String(err));
        }
        json(response, 200, { ok: true, name });
      }
    },
    {
      method: 'DELETE',
      pattern: '/api/secrets/:name',
      handler: ({ requireParam, response }) => {
        const name = requireParam('name');
        if (!runtime.secretVault.delete(name)) throw new NotFoundError('Secret', name);
        json(response, 200, { ok: true, name });
      }
    }
  ];
}
