/**
 * Model-initiated macro compaction. Calls the existing autoCompact API.
 */

import type { RunContext, ToolContract } from '../types.js';

export interface CompactContextServices {
  compactContext: (context: RunContext, opts?: { force?: boolean }) => Promise<string>;
}

export function createCompactContextTool(services: CompactContextServices): ToolContract<{ force?: boolean }> {
  return {
    name: 'compact_context',
    description:
      'Compact the current session history into a summary (macro compaction). Use when context is large or the user asks to summarize/forget details. Does not delete the WAL.',
    inputSchema: {
      type: 'object',
      properties: {
        force: {
          type: 'boolean',
          description: 'Compact even when under the token threshold (default true for this tool)'
        }
      }
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context, args) {
      const force = args.force !== false;
      const text = await services.compactContext(context, { force });
      return { ok: true, content: text };
    }
  };
}
