import { materializePtcCellTool, type DynToolMaterializeDeps } from './materialize.js';
import { collectReservedDynToolNames } from './names.js';
import { readDynToolSettings, type DynToolSettingsStore } from './settings.js';
import type { DynToolStore } from './store.js';
import {
  DEFAULT_DYN_TOOL_INPUT_SCHEMA,
  DynToolError,
  PROPOSE_TOOL_NAME,
  type DynToolFixture,
  type DynToolRecord
} from './types.js';
import type { RunContext, ToolContract, ToolExecutionResult } from '../types.js';

export interface ProposeToolDeps extends DynToolMaterializeDeps {
  getStore(context: RunContext): DynToolStore | undefined;
  settingsStore?: DynToolSettingsStore;
  getProcessTools?: () => Array<{ name: string }>;
}

export interface ProposeToolArgs extends Record<string, unknown> {
  name?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  code?: string;
  fixtures?: DynToolFixture[];
}

function fail(content: string): ToolExecutionResult {
  return { ok: false, content };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a == null || b == null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a as object).sort();
    const bk = Object.keys(b as object).sort();
    return ak.length === bk.length && ak.every((k, i) => k === bk[i] && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

export async function runDynToolFixtures(
  record: DynToolRecord,
  fixtures: DynToolFixture[],
  context: RunContext,
  deps: DynToolMaterializeDeps
): Promise<{ ok: boolean; logs: string[] }> {
  const logs: string[] = [];
  if (fixtures.length === 0) {
    return { ok: false, logs: ['propose_tool requires 1–3 fixtures'] };
  }
  if (fixtures.length > 3) {
    return { ok: false, logs: ['propose_tool accepts at most 3 fixtures'] };
  }
  let tool: ToolContract<Record<string, unknown>>;
  try {
    tool = materializePtcCellTool(record, deps);
  } catch (error) {
    return { ok: false, logs: [error instanceof Error ? error.message : String(error)] };
  }
  for (let i = 0; i < fixtures.length; i += 1) {
    const fixture = fixtures[i]!;
    const args = fixture.args && typeof fixture.args === 'object' && !Array.isArray(fixture.args) ? fixture.args : {};
    const result = await tool.execute(context, args);
    if (!result.ok) {
      logs.push(`fixture[${i}] execute failed: ${result.content}`);
      return { ok: false, logs };
    }
    if (fixture.expect === undefined) {
      logs.push(`fixture[${i}] ok`);
      continue;
    }
    let parsed: { result?: unknown };
    try {
      parsed = JSON.parse(result.content) as { result?: unknown };
    } catch {
      logs.push(`fixture[${i}] result is not JSON`);
      return { ok: false, logs };
    }
    const expect = fixture.expect;
    if (expect && typeof expect === 'object' && !Array.isArray(expect) && 'contains' in expect) {
      const needle = String((expect as { contains: unknown }).contains);
      if (!result.content.includes(needle)) {
        logs.push(`fixture[${i}] expected contains ${JSON.stringify(needle)}`);
        return { ok: false, logs };
      }
    } else if (!deepEqual(parsed.result, expect)) {
      logs.push(
        `fixture[${i}] expected ${JSON.stringify(expect)} got ${JSON.stringify(parsed.result)}`
      );
      return { ok: false, logs };
    }
    logs.push(`fixture[${i}] ok`);
  }
  return { ok: true, logs };
}

export function createProposeTool(deps: ProposeToolDeps): ToolContract<ProposeToolArgs> {
  return {
    name: PROPOSE_TOOL_NAME,
    description:
      'Propose a ptc_cell tool with 1–3 isolate fixtures. All fixtures must pass before the tool becomes active; otherwise it stays draft and is not hydrated.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        inputSchema: { type: 'object' },
        code: { type: 'string' },
        fixtures: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              args: { type: 'object' },
              expect: {}
            },
            required: ['args']
          }
        }
      },
      required: ['name', 'description', 'code', 'fixtures']
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context, args) {
      const settings = readDynToolSettings(deps.settingsStore);
      if (!settings.enabled) {
        return fail('propose_tool is disabled. Enable Dynamic tools in Lab → More.');
      }
      if (!settings.allowPropose) {
        return fail('propose_tool is disabled by Lab setting allowPropose=false.');
      }
      const store = deps.getStore(context);
      if (!store) return fail('Dynamic tool store is unavailable.');
      const code = typeof args.code === 'string' ? args.code : '';
      const fixtures = Array.isArray(args.fixtures) ? args.fixtures : [];
      const draft: DynToolRecord = {
        name: String(args.name ?? ''),
        description: String(args.description ?? ''),
        inputSchema: args.inputSchema ?? { ...DEFAULT_DYN_TOOL_INPUT_SCHEMA },
        kind: 'ptc_cell',
        source: { code },
        scope: 'session.scratch',
        status: 'draft',
        stats: { uses: 0 },
        tests: fixtures,
        createdFrom: { sessionId: context.session.id },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const ran = await runDynToolFixtures(draft, fixtures, context, deps);
      const status = ran.ok ? 'active' : 'draft';
      try {
        const record = store.upsert({
          name: draft.name,
          description: draft.description,
          inputSchema: draft.inputSchema,
          source: { code },
          scope: 'session.scratch',
          status,
          tests: fixtures,
          sessionId: context.session.id,
          createdFrom: draft.createdFrom,
          reservedNames: collectReservedDynToolNames(deps.getProcessTools?.())
        });
        deps.emitTrace?.(context.session.id, {
          kind: 'dyn_tool_propose',
          payload: { name: record.name, status: record.status, ok: ran.ok, fixtures: fixtures.length }
        });
        return {
          ok: ran.ok,
          content: JSON.stringify({
            ok: ran.ok,
            name: record.name,
            status: record.status,
            logs: ran.logs,
            note: ran.ok
              ? 'Available on the next inner-loop turn tools[]'
              : 'Kept as draft; not hydrated until fixtures pass'
          })
        };
      } catch (error) {
        if (error instanceof DynToolError) {
          return fail(`${error.code}: ${error.message}\n${ran.logs.join('\n')}`);
        }
        return fail(error instanceof Error ? error.message : String(error));
      }
    }
  };
}
