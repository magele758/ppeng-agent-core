import type { ToolContract } from '../types.js';
import type { MemoryToolServices } from './runtime-tool-services.js';

export function createMemoryTools(services: MemoryToolServices): ToolContract<any>[] {
  const memorySetTool: ToolContract<{ scope: 'scratch' | 'long'; key: string; value: string }> = {
    name: 'memory_set',
    description: 'Store a key/value in session memory (scratch is copied on subagent handoff).',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['scratch', 'long'] },
        key: { type: 'string' },
        value: { type: 'string' }
      },
      required: ['scope', 'key', 'value']
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context, args) {
      await services.upsertSessionMemory(context.session.id, args.scope, args.key, args.value);
      return { ok: true, content: `Set ${args.scope}/${args.key}` };
    }
  };

  const memoryGetTool: ToolContract<{ scope?: 'scratch' | 'long' }> = {
    name: 'memory_get',
    description: 'List session memory entries.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['scratch', 'long'] }
      }
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context, args) {
      const rows = await services.listSessionMemory(context.session.id, args.scope);
      return {
        ok: true,
        content: rows.length > 0 ? JSON.stringify(rows, null, 2) : 'No memory entries.'
      };
    }
  };

  const memoryDeleteTool: ToolContract<{ scope: 'scratch' | 'long'; key: string }> = {
    name: 'memory_delete',
    description: 'Delete one memory key.',
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

  return [memorySetTool, memoryGetTool, memoryDeleteTool, handoffStateTool];
}
