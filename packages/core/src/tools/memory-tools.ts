import type { ToolContract } from '../types.js';
import { evaluateMemoryWrite } from '../memory/memory-gate.js';
import type { MemoryScope } from '../memory/types.js';
import type { MemoryToolServices } from './runtime-tool-services.js';

const SESSION_SCOPES = new Set(['scratch', 'long']);

const AGENT_SCOPE_MAP: Record<string, MemoryScope> = {
  scratch: 'session.scratch',
  long: 'session.long',
  user: 'user.memory',
  team: 'team.memory',
  project: 'project.memory'
};

export type MemoryToolScope = 'scratch' | 'long' | 'user' | 'team' | 'project';

export interface ExtendedMemoryToolServices extends MemoryToolServices {
  /** Optional multi-layer AgentMemoryStore path (user/team/project). */
  upsertAgentMemory?: (input: {
    scope: MemoryScope;
    namespace: string;
    key: string;
    value: string;
    sessionId?: string;
    userId?: string;
    tenantId?: string;
  }) => Promise<void>;
  listAgentMemory?: (input: {
    scope: MemoryScope;
    sessionId?: string;
    userId?: string;
    tenantId?: string;
    limit?: number;
  }) => Promise<unknown[]>;
  prefetchAgentMemory?: (input: {
    sessionId: string;
    userId?: string;
    tenantId?: string;
    query?: string;
    limit?: number;
  }) => Promise<unknown[]>;
}

function resolveIds(context: { session: { id: string; metadata: Record<string, unknown> } }): {
  userId?: string;
  tenantId?: string;
} {
  const userId =
    typeof context.session.metadata.userId === 'string'
      ? context.session.metadata.userId
      : process.env.RAW_AGENT_DEFAULT_USER_ID?.trim() || undefined;
  const tenantId =
    typeof context.session.metadata.tenantId === 'string'
      ? context.session.metadata.tenantId
      : process.env.RAW_AGENT_DEFAULT_TENANT_ID?.trim() || undefined;
  return { userId, tenantId };
}

export function createMemoryTools(services: ExtendedMemoryToolServices): ToolContract<any>[] {
  const memorySetTool: ToolContract<{
    scope: MemoryToolScope;
    key: string;
    value: string;
    namespace?: string;
  }> = {
    name: 'memory_set',
    description:
      'Store a key/value in memory. scope: scratch|long (session), or user|team|project (multi-layer AgentMemoryStore).',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['scratch', 'long', 'user', 'team', 'project'] },
        key: { type: 'string' },
        value: { type: 'string' },
        namespace: { type: 'string', description: 'Optional namespace for user/team/project scopes (default: default)' }
      },
      required: ['scope', 'key', 'value']
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context, args) {
      const kind =
        args.scope === 'user' || args.scope === 'team' || args.scope === 'project' ? 'semantic' : 'scratch';
      const gate = evaluateMemoryWrite({
        value: args.value,
        key: args.key,
        kind,
        metadata: { scope: args.scope }
      });
      if (!gate.allow) {
        return { ok: false, content: `Memory write rejected (${gate.reason})` };
      }
      if (SESSION_SCOPES.has(args.scope)) {
        await services.upsertSessionMemory(
          context.session.id,
          args.scope as 'scratch' | 'long',
          args.key,
          args.value
        );
        return { ok: true, content: `Set ${args.scope}/${args.key}` };
      }
      if (!services.upsertAgentMemory) {
        return {
          ok: false,
          content: 'Multi-layer memory backend not available (set RAW_AGENT_MEMORY_BACKEND=agent).'
        };
      }
      const agentScope = AGENT_SCOPE_MAP[args.scope];
      if (!agentScope) {
        return { ok: false, content: `Unknown scope ${args.scope}` };
      }
      const ids = resolveIds(context);
      await services.upsertAgentMemory({
        scope: agentScope,
        namespace: args.namespace?.trim() || 'default',
        key: args.key,
        value: args.value,
        sessionId: context.session.id,
        userId: ids.userId,
        tenantId: ids.tenantId
      });
      return { ok: true, content: `Set ${agentScope}/${args.namespace ?? 'default'}/${args.key}` };
    }
  };

  const memoryGetTool: ToolContract<{ scope?: MemoryToolScope; namespace?: string }> = {
    name: 'memory_get',
    description: 'List memory entries for a scope (scratch|long|user|team|project).',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['scratch', 'long', 'user', 'team', 'project'] },
        namespace: { type: 'string' }
      }
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    ptc: { kind: 'read' },
    async execute(context, args) {
      const scope = args.scope ?? 'scratch';
      if (SESSION_SCOPES.has(scope)) {
        const rows = await services.listSessionMemory(context.session.id, scope as 'scratch' | 'long');
        return {
          ok: true,
          content: rows.length > 0 ? JSON.stringify(rows, null, 2) : 'No memory entries.'
        };
      }
      if (!services.listAgentMemory) {
        return { ok: false, content: 'Multi-layer memory backend not available.' };
      }
      const agentScope = AGENT_SCOPE_MAP[scope];
      if (!agentScope) {
        return { ok: false, content: `Unknown scope ${scope}` };
      }
      const ids = resolveIds(context);
      const rows = await services.listAgentMemory({
        scope: agentScope,
        sessionId: context.session.id,
        userId: ids.userId,
        tenantId: ids.tenantId,
        limit: 40
      });
      return {
        ok: true,
        content: rows.length > 0 ? JSON.stringify(rows, null, 2) : 'No memory entries.'
      };
    }
  };

  const memoryDeleteTool: ToolContract<{ scope: 'scratch' | 'long'; key: string }> = {
    name: 'memory_delete',
    description: 'Delete one session memory key (scratch|long only).',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['scratch', 'long'] },
        key: { type: 'string' }
      },
      required: ['scope', 'key']
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context, args) {
      const ok = await services.deleteSessionMemory(context.session.id, args.scope, args.key);
      return { ok, content: ok ? `Deleted ${args.scope}/${args.key}` : 'Key not found' };
    }
  };

  const handoffStateTool: ToolContract<{ notes: string }> = {
    name: 'handoff_state',
    description: 'Record handoff notes into scratch memory for subagents/teammates (key handoff.notes).',
    inputSchema: {
      type: 'object',
      properties: {
        notes: { type: 'string' }
      },
      required: ['notes']
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context, args) {
      await services.upsertSessionMemory(context.session.id, 'scratch', 'handoff.notes', args.notes);
      return { ok: true, content: 'Handoff notes stored in scratch memory.' };
    }
  };

  const memoryPrefetchTool: ToolContract<{ query?: string; limit?: number }> = {
    name: 'memory_prefetch',
    description:
      'Prefetch relevant multi-layer memories (user/team/project + session) for the current turn. Prefer injecting into the next user message rather than mutating system prompt.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' }
      }
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    ptc: { kind: 'read' },
    async execute(context, args) {
      if (!services.prefetchAgentMemory) {
        const rows = await services.listSessionMemory(context.session.id);
        return {
          ok: true,
          content: rows.length ? JSON.stringify(rows.slice(0, args.limit ?? 20), null, 2) : 'No memory.'
        };
      }
      const ids = resolveIds(context);
      const rows = await services.prefetchAgentMemory({
        sessionId: context.session.id,
        userId: ids.userId,
        tenantId: ids.tenantId,
        query: args.query,
        limit: args.limit ?? 20
      });
      return {
        ok: true,
        content: rows.length ? JSON.stringify(rows, null, 2) : 'No memory matches.'
      };
    }
  };

  return [memorySetTool, memoryGetTool, memoryDeleteTool, handoffStateTool, memoryPrefetchTool];
}
