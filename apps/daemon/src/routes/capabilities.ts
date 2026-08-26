/**
 * Capability Discovery Registry HTTP API.
 * Feature switches: Lab UI / PATCH /api/capabilities/settings (persisted).
 * Env vars are CI/bootstrap fallback only when settings were never saved.
 */

import {
  CapabilityRegistry,
  NotFoundError,
  ValidationError,
  parseTailscaleStatusJson,
  loadTailscaleStatusFromFile,
  resolveTailscaleStatus,
  applyVerify,
  verifyCapability,
  readDiscoverySettings,
  writeDiscoverySettings,
  resolveDiscoveryEnabled,
  resolveTailscaleDiscoveryEnabled,
  resolveDiscoveryProbeOverrides,
  type CapabilityKind,
  type CapabilityTrust,
  type CreateCapabilityInput,
  type DiscoverySettingsPatch,
  type RawAgentRuntime,
  type UpdateCapabilityInput
} from '@ppeng/agent-core';
import type { RouteSpec } from '../routing.js';
import { json } from '../http-utils.js';

function disabled(response: import('node:http').ServerResponse): void {
  json(response, 404, {
    error: 'discovery disabled',
    hint: 'Enable in Lab → 更多 → 能力发现, or PATCH /api/capabilities/settings'
  });
}

function registry(runtime: RawAgentRuntime): CapabilityRegistry {
  return new CapabilityRegistry(runtime.store.capabilities());
}

export function capabilitiesRoutes(runtime: RawAgentRuntime): RouteSpec[] {
  return [
    {
      method: 'GET',
      pattern: '/api/capabilities/settings',
      handler: ({ response }) => {
        const settings = readDiscoverySettings(runtime.store);
        json(response, 200, {
          settings,
          effective: {
            enabled: resolveDiscoveryEnabled(runtime.store, process.env),
            tailscaleEnabled: resolveTailscaleDiscoveryEnabled(runtime.store, process.env),
            source: runtime.store.getDaemonControl('discovery_settings') ? 'ui' : 'env_or_default'
          }
        });
      }
    },
    {
      method: 'PATCH',
      pattern: '/api/capabilities/settings',
      handler: async ({ readBody, response }) => {
        const body = (await readBody()) as DiscoverySettingsPatch;
        const settings = writeDiscoverySettings(runtime.store, body ?? {});
        json(response, 200, {
          settings,
          effective: {
            enabled: resolveDiscoveryEnabled(runtime.store, process.env),
            tailscaleEnabled: resolveTailscaleDiscoveryEnabled(runtime.store, process.env),
            source: 'ui' as const
          }
        });
      }
    },
    {
      method: 'GET',
      pattern: '/api/capabilities/cbom',
      handler: ({ response }) => {
        if (!resolveDiscoveryEnabled(runtime.store, process.env)) return disabled(response);
        const cards = registry(runtime).listBoundCards();
        json(response, 200, {
          version: 1,
          generatedAt: new Date().toISOString(),
          capabilities: cards.map((c) => ({
            id: c.id,
            kind: c.kind,
            name: c.name,
            schemaHash: c.schemaHash,
            cbom: c.cbom ?? null,
            trust: c.trust
          }))
        });
      }
    },
    {
      method: 'GET',
      pattern: '/api/capabilities',
      handler: ({ url, response }) => {
        if (!resolveDiscoveryEnabled(runtime.store, process.env)) return disabled(response);
        const trust = url.searchParams.get('trust') as CapabilityTrust | null;
        const kind = url.searchParams.get('kind') as CapabilityKind | null;
        const pool = url.searchParams.get('pool');
        const limit = Number(url.searchParams.get('limit') ?? 200);
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const cards = registry(runtime).list({
          trust: trust ?? undefined,
          kind: kind ?? undefined,
          pool: pool ?? undefined,
          limit: Number.isFinite(limit) ? limit : 200,
          offset: Number.isFinite(offset) ? offset : 0
        });
        json(response, 200, { capabilities: cards });
      }
    },
    {
      method: 'POST',
      pattern: '/api/capabilities',
      handler: async ({ readBody, response }) => {
        if (!resolveDiscoveryEnabled(runtime.store, process.env)) return disabled(response);
        const body = (await readBody()) as CreateCapabilityInput;
        const card = registry(runtime).create(body);
        json(response, 201, { capability: card });
      }
    },
    {
      method: 'GET',
      pattern: '/api/capabilities/:id',
      handler: ({ requireParam, response }) => {
        if (!resolveDiscoveryEnabled(runtime.store, process.env)) return disabled(response);
        const id = requireParam('id');
        const card = registry(runtime).get(id);
        if (!card) throw new NotFoundError('Capability', id);
        json(response, 200, { capability: card });
      }
    },
    {
      method: 'PATCH',
      pattern: '/api/capabilities/:id',
      handler: async ({ requireParam, readBody, response }) => {
        if (!resolveDiscoveryEnabled(runtime.store, process.env)) return disabled(response);
        const id = requireParam('id');
        const body = (await readBody()) as UpdateCapabilityInput;
        const card = registry(runtime).update(id, body);
        json(response, 200, { capability: card });
      }
    },
    {
      method: 'POST',
      pattern: '/api/capabilities/:id/bind',
      handler: async ({ requireParam, readBody, response }) => {
        if (!resolveDiscoveryEnabled(runtime.store, process.env)) return disabled(response);
        const id = requireParam('id');
        const body = (await readBody()) as {
          approved?: boolean;
          bindings?: Array<{ toolName: string; schemaHashPin: string; metadata?: Record<string, unknown> }>;
        };
        if (body.approved !== true) {
          throw new ValidationError('bind requires approved=true (HITL)');
        }
        const result = registry(runtime).bind(id, {
          approved: true,
          bindings: body.bindings
        });
        json(response, 200, result);
      }
    },
    {
      method: 'POST',
      pattern: '/api/capabilities/:id/verify',
      handler: async ({ requireParam, readBody, response }) => {
        if (!resolveDiscoveryEnabled(runtime.store, process.env)) return disabled(response);
        const id = requireParam('id');
        const reg = registry(runtime);
        const card = reg.get(id);
        if (!card) throw new NotFoundError('Capability', id);
        const body = (await readBody()) as Record<string, unknown>;
        const schemaBody = typeof body.body === 'string' ? body.body : undefined;
        const result = applyVerify(reg, id, verifyCapability(card, { body: schemaBody }));
        json(response, 200, { result });
      }
    },
    {
      method: 'POST',
      pattern: '/api/capabilities/probe/tailscale',
      handler: async ({ readBody, response }) => {
        if (!resolveDiscoveryEnabled(runtime.store, process.env)) return disabled(response);
        if (!resolveTailscaleDiscoveryEnabled(runtime.store, process.env)) {
          json(response, 404, {
            error: 'tailscale discovery disabled',
            hint: 'Enable Tailscale in Lab → 更多 → 能力发现'
          });
          return;
        }
        const body = (await readBody()) as Record<string, unknown>;
        const reg = registry(runtime);
        const overrides = resolveDiscoveryProbeOverrides(runtime.store);
        let status;
        let source: string;
        if (typeof body.statusJson === 'object' && body.statusJson != null) {
          status = body.statusJson as Parameters<typeof parseTailscaleStatusJson>[0];
          source = 'body';
        } else if (typeof body.statusFile === 'string') {
          status = loadTailscaleStatusFromFile(body.statusFile);
          source = 'file';
        } else {
          const resolved = await resolveTailscaleStatus(process.env, {
            statusJsonPath: overrides.statusJsonPath
          });
          status = resolved.status;
          source = resolved.source;
        }
        const candidates = parseTailscaleStatusJson(status);
        const created = candidates.map((c) => reg.create(c));
        json(response, 201, { source, count: created.length, capabilities: created });
      }
    }
  ];
}
