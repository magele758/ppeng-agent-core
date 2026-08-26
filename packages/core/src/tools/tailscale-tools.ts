/**
 * Tailscale read-only inventory tools (gated by discovery settings / UI).
 */

import { envBool } from '../env.js';
import type { CapabilityRegistry } from '../discovery/registry.js';
import {
  resolveTailscaleDiscoveryEnabled,
  type DiscoverySettingsStore
} from '../discovery/settings.js';
import type { ToolContract, ToolExecutionResult } from '../types.js';

export interface TailscaleToolServices {
  getRegistry: () => CapabilityRegistry;
  env?: NodeJS.ProcessEnv;
  settingsStore?: DiscoverySettingsStore;
  isEnabled?: () => boolean;
}

export function createTailscaleTools(services: TailscaleToolServices): ToolContract<any>[] {
  const env = () => services.env ?? process.env;
  const enabled = () =>
    services.isEnabled?.() ??
    resolveTailscaleDiscoveryEnabled(services.settingsStore, env());

  const listDevices: ToolContract<{ pool?: string; onlineOnly?: boolean }> = {
    name: 'tailscale_list_devices',
    description:
      'List Tailscale nodes from the Capability Registry (kind=tailscale-node). Read-only inventory.',
    inputSchema: {
      type: 'object',
      properties: {
        pool: { type: 'string' },
        onlineOnly: { type: 'boolean' }
      }
    },
    approvalMode: 'never',
    sideEffectLevel: 'system',
    async execute(_ctx, args): Promise<ToolExecutionResult> {
      if (!enabled()) {
        return { ok: false, content: 'Tailscale discovery disabled (enable in Lab → 更多 → 能力发现)' };
      }
      let cards = services.getRegistry().list({ kind: 'tailscale-node', pool: args.pool, limit: 500 });
      if (args.onlineOnly) {
        cards = cards.filter((c) => c.metadata?.online !== false && c.metadata?.operable !== false);
      }
      const devices = cards.map((c) => ({
        id: c.id,
        name: c.name,
        endpoint: c.endpoint,
        trust: c.trust,
        pool: c.pool,
        online: c.metadata?.online !== false,
        operable: c.trust === 'bound' && c.metadata?.online !== false && c.metadata?.operable !== false,
        role: c.metadata?.role,
        dnsName: c.metadata?.dnsName,
        tags: c.tags
      }));
      return { ok: true, content: JSON.stringify({ count: devices.length, devices }, null, 2) };
    }
  };

  const getDevice: ToolContract<{ id: string }> = {
    name: 'tailscale_get_device',
    description: 'Get a single Tailscale node capability card by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id']
    },
    approvalMode: 'never',
    sideEffectLevel: 'system',
    async execute(_ctx, args): Promise<ToolExecutionResult> {
      if (!enabled()) {
        return { ok: false, content: 'Tailscale discovery disabled (enable in Lab → 更多 → 能力发现)' };
      }
      const id = String(args.id ?? '').trim();
      const card = services.getRegistry().get(id);
      if (!card || card.kind !== 'tailscale-node') {
        return { ok: false, content: `tailscale-node not found: ${id}` };
      }
      const operable =
        card.trust === 'bound' &&
        card.metadata?.online !== false &&
        card.metadata?.operable !== false;
      return {
        ok: true,
        content: JSON.stringify({ ...card, operable }, null, 2)
      };
    }
  };

  const tools = [listDevices, getDevice];

  if (envBool(env(), 'RAW_AGENT_TAILSCALE_PING', false)) {
    const ping: ToolContract<{ id: string }> = {
      name: 'tailscale_ping',
      description: 'Optional connectivity probe (policy-gated; default off).',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id']
      },
      approvalMode: 'always',
      sideEffectLevel: 'system',
      async execute(_ctx, args): Promise<ToolExecutionResult> {
        if (!enabled()) return { ok: false, content: 'Tailscale discovery disabled' };
        const card = services.getRegistry().get(String(args.id ?? ''));
        if (!card || card.kind !== 'tailscale-node') {
          return { ok: false, content: 'not found' };
        }
        if (card.metadata?.online === false) {
          return { ok: false, content: 'offline node: ping refused' };
        }
        return {
          ok: true,
          content: JSON.stringify({
            id: card.id,
            reachable: 'unknown',
            note: 'ping stub — use Tailscale CLI externally'
          })
        };
      }
    };
    tools.push(ping);
  }

  return tools;
}
