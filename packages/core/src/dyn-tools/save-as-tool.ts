import type { RunContext, ToolContract, ToolExecutionResult } from '../types.js';
import { collectReservedDynToolNames } from './names.js';
import { readDynToolSettings, type DynToolSettingsStore } from './settings.js';
import type { DynToolStore } from './store.js';
import { DynToolError, SAVE_AS_TOOL_NAME, type DynToolRecord } from './types.js';

export interface SaveAsToolDeps {
  getStore(context: RunContext): DynToolStore | undefined;
  settingsStore?: DynToolSettingsStore;
  getProcessTools?: () => Array<{ name: string }>;
  emitTrace?: (sessionId: string, event: { kind: string; payload?: Record<string, unknown> }) => void;
}

export interface SaveAsToolArgs extends Record<string, unknown> {
  name?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  code?: string;
  status?: 'draft' | 'active';
}

function fail(content: string): ToolExecutionResult {
  return { ok: false, content };
}

export function createSaveAsTool(deps: SaveAsToolDeps): ToolContract<SaveAsToolArgs> {
  return {
    name: SAVE_AS_TOOL_NAME,
    description:
      'Explicitly harvest the last successful PTC cell (session.metadata.ptcLastProgram) or explicit code into a named ptc_cell tool. ptc_exec never auto-harvests — you must call this. Visible next inner-loop turn. Default status is active. Equivalent to a reusable ptc_exec cell.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Tool name: ^[a-z][a-z0-9_]{1,47}$' },
        description: { type: 'string' },
        inputSchema: { type: 'object', description: 'JSON schema for tool arguments (bound as isolate args).' },
        code: { type: 'string', description: 'Optional cell source. Defaults to ptcLastProgram.' },
        status: { type: 'string', enum: ['draft', 'active'] }
      },
      required: ['name', 'description']
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context, args) {
      const settings = readDynToolSettings(deps.settingsStore);
      if (!settings.enabled) {
        return fail('save_as_tool is disabled. Enable Dynamic tools in Lab → More.');
      }
      if (!settings.allowSave) {
        return fail('save_as_tool is disabled by Lab setting allowSave=false.');
      }
      const store = deps.getStore(context);
      if (!store) {
        return fail('Dynamic tool store is unavailable.');
      }
      const explicit = typeof args.code === 'string' ? args.code : '';
      const last =
        typeof context.session.metadata?.ptcLastProgram === 'string'
          ? context.session.metadata.ptcLastProgram
          : '';
      const code = explicit.trim() ? explicit : last;
      if (!code.trim()) {
        return fail('No code to harvest. Run ptc_exec first or pass code.');
      }
      const fromLast = !explicit.trim() && Boolean(last);
      try {
        const record: DynToolRecord = store.upsert({
          name: String(args.name ?? ''),
          description: String(args.description ?? ''),
          inputSchema: args.inputSchema,
          source: { code },
          scope: 'session.scratch',
          status: args.status === 'draft' ? 'draft' : 'active',
          sessionId: context.session.id,
          createdFrom: { sessionId: context.session.id, ptcLastProgram: fromLast },
          reservedNames: collectReservedDynToolNames(deps.getProcessTools?.())
        });
        deps.emitTrace?.(context.session.id, {
          kind: 'dyn_tool_save',
          payload: { name: record.name, status: record.status, fromLastProgram: fromLast }
        });
        return {
          ok: true,
          content: JSON.stringify({
            ok: true,
            name: record.name,
            status: record.status,
            scope: record.scope,
            note: 'Available on the next inner-loop turn tools[]'
          })
        };
      } catch (error) {
        if (error instanceof DynToolError) {
          return fail(`${error.code}: ${error.message}`);
        }
        return fail(error instanceof Error ? error.message : String(error));
      }
    }
  };
}
