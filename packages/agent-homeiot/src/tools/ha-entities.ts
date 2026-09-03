import type { ToolContract, ToolExecutionResult } from '@ppeng/agent-core';
import {
  httpJson,
  isMockEnabled,
  mockEntities,
  mockEntityState,
  resolveHaCreds,
  truncate,
} from '../util.js';

type ListArgs = {
  /** Optional domain filter, e.g. "light" or "sensor". */
  domain?: string;
  /** Override HOME_ASSISTANT_URL (test / ad-hoc). */
  base_url?: string;
};

type GetStateArgs = {
  entity_id: string;
  /** Override HOME_ASSISTANT_URL (test / ad-hoc). */
  base_url?: string;
};

function filterByDomain(
  entities: Record<string, unknown>[],
  domain?: string,
): Record<string, unknown>[] {
  const d = domain?.trim().toLowerCase();
  if (!d) return entities;
  return entities.filter((e) => String(e.entity_id ?? '').toLowerCase().startsWith(`${d}.`));
}

export const haListEntitiesTool: ToolContract<ListArgs> = {
  name: 'ha_list_entities',
  description:
    'List Home Assistant entity states (GET /api/states). Read-only. Uses HOME_ASSISTANT_URL + HOME_ASSISTANT_TOKEN (credRef-style env). Set HOME_ASSISTANT_MOCK=1 for offline fixtures.',
  inputSchema: {
    type: 'object',
    properties: {
      domain: {
        type: 'string',
        description: 'Optional domain filter, e.g. light, sensor, switch',
      },
      base_url: {
        type: 'string',
        description: 'Override HOME_ASSISTANT_URL for ad-hoc / test calls',
      },
    },
  },
  approvalMode: 'never',
  sideEffectLevel: 'system',
  ptc: { kind: 'read' },
  async execute(_context, args): Promise<ToolExecutionResult> {
    if (isMockEnabled()) {
      const entities = filterByDomain(mockEntities(), args.domain);
      return { ok: true, content: truncate(JSON.stringify(entities, null, 2)) };
    }
    const creds = resolveHaCreds({ base_url: args.base_url });
    if (!creds.ok) return creds.result;
    const result = await httpJson({
      url: `${creds.base}/api/states`,
      auth: `Bearer ${creds.token}`,
    });
    if (!result.ok || !args.domain?.trim()) return result;
    try {
      const parsed = JSON.parse(result.content) as Record<string, unknown>[];
      if (!Array.isArray(parsed)) return result;
      const filtered = filterByDomain(parsed, args.domain);
      return { ok: true, content: truncate(JSON.stringify(filtered, null, 2)) };
    } catch {
      return result;
    }
  },
};

export const haGetStateTool: ToolContract<GetStateArgs> = {
  name: 'ha_get_state',
  description:
    'Get a single Home Assistant entity state (GET /api/states/<entity_id>). Read-only. Uses HOME_ASSISTANT_URL + HOME_ASSISTANT_TOKEN (credRef-style env). Set HOME_ASSISTANT_MOCK=1 for offline fixtures.',
  inputSchema: {
    type: 'object',
    properties: {
      entity_id: {
        type: 'string',
        description: 'Entity id, e.g. light.living_room or sensor.living_room_temperature',
      },
      base_url: {
        type: 'string',
        description: 'Override HOME_ASSISTANT_URL for ad-hoc / test calls',
      },
    },
    required: ['entity_id'],
  },
  approvalMode: 'never',
  sideEffectLevel: 'system',
  ptc: { kind: 'read' },
  async execute(_context, args): Promise<ToolExecutionResult> {
    const entityId = String(args.entity_id ?? '').trim();
    if (!entityId) return { ok: false, content: 'entity_id is required' };

    if (isMockEnabled()) {
      const entity = mockEntityState(entityId);
      if (!entity) {
        return { ok: false, content: `Entity not found in mock data: ${entityId}` };
      }
      return { ok: true, content: truncate(JSON.stringify(entity, null, 2)) };
    }

    const creds = resolveHaCreds({ base_url: args.base_url });
    if (!creds.ok) return creds.result;
    return httpJson({
      url: `${creds.base}/api/states/${encodeURIComponent(entityId)}`,
      auth: `Bearer ${creds.token}`,
    });
  },
};
