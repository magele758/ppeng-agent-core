import type { RunContext, ToolContract } from '../types.js';
import { hydrateTurnDynTools } from './hydrate.js';
import type { DynToolMaterializeDeps } from './materialize.js';
import { createProposeTool, type ProposeToolDeps } from './propose-tool.js';
import { createSaveAsTool, type SaveAsToolDeps } from './save-as-tool.js';
import { searchDynTools } from './search.js';
import { readDynToolSettings, type DynToolSettingsStore } from './settings.js';
import { tryCreateDynToolStore, type DynToolStore } from './store.js';
import { SEARCH_DYN_TOOLS_NAME } from './types.js';

export interface SearchDynToolsDeps {
  getStore(context: RunContext): DynToolStore | undefined;
  settingsStore?: DynToolSettingsStore;
  emitTrace?: (sessionId: string, event: { kind: string; payload?: Record<string, unknown> }) => void;
}

export function createSearchDynTools(deps: SearchDynToolsDeps): ToolContract<{ query?: string; limit?: number }> {
  return {
    name: SEARCH_DYN_TOOLS_NAME,
    description:
      'Search harvested dynamic tools by name/description (lexical). Returns a shortlist; hydrate still keeps sticky used tools.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' }
      }
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context, args) {
      const settings = readDynToolSettings(deps.settingsStore);
      if (!settings.enabled) {
        return { ok: false, content: 'search_dyn_tools is disabled. Enable Dynamic tools in Lab → More.' };
      }
      const store = deps.getStore(context);
      if (!store) return { ok: false, content: 'Dynamic tool store is unavailable.' };
      const limit =
        typeof args.limit === 'number' && Number.isFinite(args.limit)
          ? Math.max(1, Math.min(20, Math.floor(args.limit)))
          : settings.hydrateTopK;
      const listed = store.list({ sessionId: context.session.id }).filter((r) => r.status === 'active');
      const hits = searchDynTools(String(args.query ?? ''), listed, limit);
      return {
        ok: true,
        content: JSON.stringify({
          ok: true,
          query: String(args.query ?? ''),
          tools: hits.map((r) => ({ name: r.name, description: r.description, scope: r.scope }))
        })
      };
    }
  };
}

export function createDynMetaTools(
  deps: SaveAsToolDeps & ProposeToolDeps & SearchDynToolsDeps
): ToolContract<any>[] {
  return [createSaveAsTool(deps), createProposeTool(deps), createSearchDynTools(deps)];
}

export function createDynMaterializeDepsFromHost(input: {
  getAuthorizedTools: DynToolMaterializeDeps['getAuthorizedTools'];
  spawnSubagent?: DynToolMaterializeDeps['spawnSubagent'];
  createScratchPersist?: DynToolMaterializeDeps['createScratchPersist'];
  goalSettingsStore?: DynToolMaterializeDeps['goalSettingsStore'];
  emitTrace?: DynToolMaterializeDeps['emitTrace'];
}): DynToolMaterializeDeps {
  return {
    getAuthorizedTools: input.getAuthorizedTools,
    spawnSubagent: input.spawnSubagent,
    createScratchPersist: input.createScratchPersist,
    goalSettingsStore: input.goalSettingsStore,
    emitTrace: input.emitTrace
  };
}

export { hydrateTurnDynTools, tryCreateDynToolStore };
