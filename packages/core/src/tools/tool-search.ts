/**
 * Tool Search meta-tools — progressive disclosure for bound capabilities.
 */

import { envBool, envInt } from '../env.js';
import type { CapabilityCard } from '../discovery/types.js';
import type { CapabilityRegistry } from '../discovery/registry.js';
import {
  resolveDiscoveryEnabled,
  type DiscoverySettingsStore
} from '../discovery/settings.js';
import type { ToolContract, ToolExecutionResult } from '../types.js';

/** Env-only helper for unit tests; runtime should use resolveDiscoveryEnabled(store). */
export function discoveryToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return envBool(env, 'RAW_AGENT_DISCOVERY', false);
}

export function toolDisclosureBudget(env: NodeJS.ProcessEnv = process.env): number {
  return envInt(env, 'RAW_AGENT_TOOL_DISCLOSURE_BUDGET', 20);
}

export function toolLoadStrict(env: NodeJS.ProcessEnv = process.env): boolean {
  return envBool(env, 'RAW_AGENT_TOOL_LOAD_STRICT', false);
}

function scoreCard(card: CapabilityCard, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  const hay = `${card.name} ${card.description ?? ''} ${card.kind} ${(card.tags ?? []).join(' ')}`.toLowerCase();
  let score = 0;
  for (const token of q.split(/\s+/)) {
    if (hay.includes(token)) score += 2;
    if (card.name.toLowerCase().includes(token)) score += 3;
  }
  return score;
}

export interface ToolSearchHit {
  id: string;
  name: string;
  description?: string;
  kind: string;
  trust: string;
  risk?: string;
}

export function searchBoundCapabilities(
  registry: CapabilityRegistry,
  query: string,
  limit: number
): ToolSearchHit[] {
  const cards = registry.listBoundCards({ limit: 500 });
  const scored = cards
    .map((c) => ({ c, s: scoreCard(c, query) }))
    .filter((x) => x.s > 0 || !query.trim())
    .sort((a, b) => b.s - a.s)
    .slice(0, limit);
  return scored.map(({ c }) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    kind: c.kind,
    trust: c.trust,
    risk: c.scope.includes('write') ? 'write' : 'read'
  }));
}

export interface ToolSearchServices {
  getRegistry: () => CapabilityRegistry;
  /** Session shortlist of capability ids (for strict load). */
  getShortlist?: (sessionId: string) => string[];
  env?: NodeJS.ProcessEnv;
  /** Prefer persisted UI settings; falls back to env when unset. */
  settingsStore?: DiscoverySettingsStore;
  isEnabled?: () => boolean;
}

export function createToolSearchTools(services: ToolSearchServices): ToolContract<any>[] {
  const env = () => services.env ?? process.env;
  const isOn = () =>
    services.isEnabled?.() ??
    resolveDiscoveryEnabled(services.settingsStore, env());

  const toolSearch: ToolContract<{ query: string; limit?: number }> = {
    name: 'tool_search',
    description:
      'Search bound capability tools by keyword. Returns top-k cards (id/name/desc). Use load_capability_tool to load full schema.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' }
      },
      required: ['query']
    },
    approvalMode: 'never',
    sideEffectLevel: 'system',
    async execute(_ctx, args): Promise<ToolExecutionResult> {
      if (!isOn()) {
        return { ok: false, content: 'Capability discovery is disabled (enable in Lab → 更多 → 能力发现)' };
      }
      const budget = toolDisclosureBudget(env());
      const limit = Math.min(
        Number.isFinite(args.limit) && (args.limit as number) > 0 ? Number(args.limit) : budget,
        budget
      );
      const hits = searchBoundCapabilities(services.getRegistry(), String(args.query ?? ''), limit);
      return {
        ok: true,
        content: JSON.stringify({ budget, count: hits.length, hits }, null, 2)
      };
    }
  };

  const loadTool: ToolContract<{ id: string }> = {
    name: 'load_capability_tool',
    description:
      'Load full schema/metadata for a bound capability id discovered via tool_search.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id']
    },
    approvalMode: 'never',
    sideEffectLevel: 'system',
    async execute(ctx, args): Promise<ToolExecutionResult> {
      if (!isOn()) {
        return { ok: false, content: 'Capability discovery is disabled (enable in Lab → 更多 → 能力发现)' };
      }
      const id = String(args.id ?? '').trim();
      if (!id) return { ok: false, content: 'id is required' };
      if (toolLoadStrict(env())) {
        const sessionId = ctx.session?.id ?? '';
        const shortlist = services.getShortlist?.(sessionId) ?? [];
        if (!shortlist.includes(id)) {
          return {
            ok: false,
            content: JSON.stringify({
              error: 'strict_load_denied',
              message: 'Capability id not in session shortlist (RAW_AGENT_TOOL_LOAD_STRICT=1)'
            })
          };
        }
      }
      const card = services.getRegistry().get(id);
      if (!card) return { ok: false, content: `Capability not found: ${id}` };
      if (card.trust !== 'bound') {
        return { ok: false, content: `Capability ${id} is not bound (trust=${card.trust})` };
      }
      const bindings = services.getRegistry().listBindings(id);
      return {
        ok: true,
        content: JSON.stringify(
          {
            id: card.id,
            name: card.name,
            description: card.description,
            kind: card.kind,
            endpoint: card.endpoint,
            schemaRef: card.schemaRef,
            schemaHash: card.schemaHash,
            scope: card.scope,
            cbom: card.cbom,
            metadata: card.metadata,
            bindings
          },
          null,
          2
        )
      };
    }
  };

  return [toolSearch, loadTool];
}
