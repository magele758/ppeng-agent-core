/**
 * GET/PATCH /api/sandbox/settings — Lab KV. Token is a SecretVault name, never the value.
 */

import {
  hasPersistedSandboxSettings,
  readSandboxSettings,
  resolveCloudflareComputer,
  resolveSandboxMode,
  writeSandboxSettings,
  type RawAgentRuntime,
  type SandboxSettingsPatch
} from '@ppeng/agent-core';
import type { RouteSpec } from '../routing.js';
import { json } from '../http-utils.js';

export function sandboxRoutes(runtime: RawAgentRuntime): RouteSpec[] {
  return [
    {
      method: 'GET',
      pattern: '/api/sandbox/settings',
      handler: ({ response }) => {
        const persisted = hasPersistedSandboxSettings(runtime.store);
        const settings = persisted
          ? readSandboxSettings(runtime.store)
          : { ...readSandboxSettings(runtime.store), mode: resolveSandboxMode(runtime.store, process.env) };
        const cf = resolveCloudflareComputer(runtime.store, process.env, runtime.secretVault);
        json(response, 200, {
          settings,
          effective: {
            mode: settings.mode,
            source: persisted ? 'ui' : 'env_or_default',
            cfEndpoint: cf.endpoint,
            cfWorkspaceName: cf.workspaceName,
            tokenPresent: cf.tokenPresent,
            tokenSource: cf.tokenSource
          }
        });
      }
    },
    {
      method: 'PATCH',
      pattern: '/api/sandbox/settings',
      handler: async ({ readBody, response }) => {
        const body = (await readBody()) as SandboxSettingsPatch;
        const settings = writeSandboxSettings(runtime.store, body ?? {});
        const cf = resolveCloudflareComputer(runtime.store, process.env, runtime.secretVault);
        json(response, 200, {
          settings,
          effective: {
            mode: settings.mode,
            source: 'ui' as const,
            cfEndpoint: cf.endpoint,
            cfWorkspaceName: cf.workspaceName,
            tokenPresent: cf.tokenPresent,
            tokenSource: cf.tokenSource
          }
        });
      }
    }
  ];
}
