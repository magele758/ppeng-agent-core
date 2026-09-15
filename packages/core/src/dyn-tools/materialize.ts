/**
 * Materialize a dyn-tools ptc_cell record into a ToolContract.
 * args are frozen onto isolate hooks — never concatenated into source.
 */

import { parseGoalVerifySpec } from '../goal/verify-spec.js';
import { runGoalVerify } from '../goal/run-verify.js';
import { readGoalSettings } from '../goal/settings.js';
import { createPtcAgentHook } from '../ptc/agent-hook.js';
import { buildPtcNamespace } from '../ptc/hooks.js';
import { clampPtcTimeoutMs, PtcIsolateError, runPtcCell } from '../ptc/isolate.js';
import { resultJson } from '../ptc/ptc-exec-tool.js';
import {
  createMemoryScratchPersist,
  PtcScratchpadSession,
  type PtcScratchPersist
} from '../ptc/scratchpad.js';
import type { PtcAgentSpec } from '../ptc/types.js';
import type { RunContext, ToolContract, ToolExecutionResult } from '../types.js';
import { DynToolError, type DynToolRecord } from './types.js';

export interface DynToolMaterializeDeps {
  getAuthorizedTools(context: RunContext): ToolContract<any>[];
  spawnSubagent?(context: RunContext, spec: PtcAgentSpec, signal: AbortSignal): Promise<string>;
  createScratchPersist?: (context: RunContext) => PtcScratchPersist;
  goalSettingsStore?: Parameters<typeof readGoalSettings>[0];
  emitTrace?: (sessionId: string, event: { kind: string; payload?: Record<string, unknown> }) => void;
}

function frozenArgs(args: Record<string, unknown>): Record<string, unknown> {
  return Object.freeze({ ...args });
}

export function materializePtcCellTool(
  record: DynToolRecord,
  deps: DynToolMaterializeDeps
): ToolContract<Record<string, unknown>> {
  const code = String(record.source?.code ?? '').trim();
  if (!code) {
    throw new DynToolError('empty_code', `Cannot materialize empty code for ${record.name}`);
  }

  return {
    name: record.name,
    description: record.description,
    inputSchema: record.inputSchema,
    approvalMode: 'auto',
    sideEffectLevel: 'none',
    async execute(context, args) {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      context.abortSignal?.addEventListener('abort', onAbort, { once: true });
      const persist = deps.createScratchPersist?.(context) ?? createMemoryScratchPersist();
      const pad = new PtcScratchpadSession(persist);
      const spawn = deps.spawnSubagent;
      const agent = createPtcAgentHook({
        concurrencyCap: 16,
        maxCalls: 64,
        signal: controller.signal,
        spawn: async (spec) => {
          if (!spawn) {
            return JSON.stringify({ ok: false, error: 'agent() is not available on this harvested tool' });
          }
          const task = spec.angle ? `[Angle: ${spec.angle}]\n\n${spec.task}` : spec.task;
          return spawn(context, { ...spec, task }, controller.signal);
        }
      });
      const namespace = buildPtcNamespace({
        context: { ...context, abortSignal: controller.signal },
        authorizedTools: deps.getAuthorizedTools(context),
        agent,
        scratchpad: {
          write: (raw, content) => pad.write(raw, content),
          read: (key) => pad.read(key),
          list: () => pad.list(),
          delete: (key) => pad.delete(key)
        },
        verify: async (raw) => {
          const spec = parseGoalVerifySpec(raw);
          if (!spec) throw new Error('verify() requires a valid files_exist or http spec');
          const result = await runGoalVerify(spec, {
            workspaceRoot: context.workspaceRoot ?? context.repoRoot,
            settings: deps.goalSettingsStore ? readGoalSettings(deps.goalSettingsStore) : undefined,
            signal: controller.signal
          });
          if (!result.ok) throw new Error(result.reason);
          return result;
        }
      });

      const hooks: Record<string, unknown> = {
        ...namespace.bindings,
        args: frozenArgs(args ?? {})
      };

      try {
        const { value, logs } = await runPtcCell(code, {
          abortController: controller,
          hooks,
          timeoutMs: clampPtcTimeoutMs()
        });
        return {
          ok: true,
          content: resultJson({ ok: true, result: value, logs, callSite: record.name })
        };
      } catch (error) {
        const isolate = error instanceof PtcIsolateError ? error : undefined;
        const message = error instanceof Error ? error.message : String(error);
        const result: ToolExecutionResult = {
          ok: false,
          content: resultJson({
            ok: false,
            error: message,
            code: isolate?.code ?? 'runtime',
            logs: [],
            callSite: record.name
          })
        };
        return result;
      } finally {
        pad.dispose();
        context.abortSignal?.removeEventListener('abort', onAbort);
      }
    }
  };
}
