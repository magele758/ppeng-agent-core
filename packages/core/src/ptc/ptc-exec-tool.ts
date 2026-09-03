import { parseGoalVerifySpec } from '../goal/verify-spec.js';
import { runGoalVerify } from '../goal/run-verify.js';
import { readGoalSettings } from '../goal/settings.js';
import type { RunContext, ToolContract } from '../types.js';
import { createPtcAgentHook } from './agent-hook.js';
import { buildPtcNamespace } from './hooks.js';
import { PtcIsolateError, runPtcCell } from './isolate.js';
import { isPtcSession } from './mode.js';
import type { PtcAgentSpec, PtcExecInput } from './types.js';

export const PTC_EXEC_TOOL_NAME = 'ptc_exec';

export interface PtcExecToolDependencies {
  getAuthorizedTools(context: RunContext): ToolContract<any>[];
  spawnSubagent(context: RunContext, spec: PtcAgentSpec, signal: AbortSignal): Promise<string>;
  scratchpad: {
    write(context: RunContext, key: string, content: string): Promise<void>;
    read(context: RunContext, key: string): Promise<unknown>;
    list(context: RunContext): Promise<unknown>;
  };
  goalSettingsStore?: Parameters<typeof readGoalSettings>[0];
  emitTrace?: (
    sessionId: string,
    event: { kind: 'ptc_cell' | 'ptc_hook'; payload?: Record<string, unknown> }
  ) => void;
  saveProgram?: (
    sessionId: string,
    patch: Record<string, unknown>
  ) => void;
}

function resultJson(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, item) => {
      if (typeof item === 'bigint') return item.toString();
      if (typeof item === 'function' || typeof item === 'symbol') return String(item);
      return item;
    }, 2) ?? 'null';
  } catch {
    return JSON.stringify({ ok: false, error: 'PTC result is not serializable' });
  }
}

export function createPtcExecTool(deps: PtcExecToolDependencies): ToolContract<PtcExecInput> {
  return {
    name: PTC_EXEC_TOOL_NAME,
    description:
      'Execute an async JavaScript workflow cell. Inside the cell use agent(), authorized read-only tools, scratchpad.write/read/list, and verify(). Use Promise.all for independent work. File writes and shell commands must remain normal parent/worker tool calls.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Async JavaScript body; return or final expression is the result.' },
        timeoutMs: { type: 'number', description: 'Optional timeout, clamped to 120000 ms.' }
      },
      required: ['code']
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context, args) {
      if (!isPtcSession(context.session)) {
        return {
          ok: false,
          content: 'ptc_exec is only available when orchestrationEngine=ptc or taskRunMode=dynamic_workflow.'
        };
      }
      const code = typeof args.code === 'string' ? args.code : '';
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      context.abortSignal?.addEventListener('abort', onAbort, { once: true });

      const agent = createPtcAgentHook({
        concurrencyCap: 16,
        maxCalls: 64,
        signal: controller.signal,
        spawn: async (spec) => {
          const task = spec.angle ? `[Angle: ${spec.angle}]\n\n${spec.task}` : spec.task;
          return deps.spawnSubagent(context, { ...spec, task }, controller.signal);
        }
      });
      const namespace = buildPtcNamespace({
        context: { ...context, abortSignal: controller.signal },
        authorizedTools: deps.getAuthorizedTools(context),
        agent,
        scratchpad: {
          write: async (key, content) => {
            if (typeof key !== 'string' || !key.trim()) throw new Error('scratchpad.write requires key');
            const text = typeof content === 'string' ? content : resultJson(content);
            await deps.scratchpad.write(context, key.trim(), text);
            return { ok: true, key: key.trim(), bytes: Buffer.byteLength(text, 'utf8') };
          },
          read: async (key) => {
            if (typeof key !== 'string' || !key.trim()) throw new Error('scratchpad.read requires key');
            return deps.scratchpad.read(context, key.trim());
          },
          list: () => deps.scratchpad.list(context)
        },
        verify: async (raw) => {
          const spec = parseGoalVerifySpec(raw);
          if (!spec) throw new Error('verify() requires a valid files_exist or http spec');
          const result = await runGoalVerify(spec, {
            workspaceRoot: context.workspaceRoot ?? context.repoRoot,
            settings: deps.goalSettingsStore
              ? readGoalSettings(deps.goalSettingsStore)
              : undefined,
            signal: controller.signal
          });
          if (!result.ok) throw new Error(result.reason);
          return result;
        },
        onToolCall: (name, result) => {
          deps.emitTrace?.(context.session.id, {
            kind: 'ptc_hook',
            payload: { name, ok: result.ok }
          });
        }
      });

      deps.emitTrace?.(context.session.id, {
        kind: 'ptc_cell',
        payload: {
          phase: 'start',
          codeChars: code.length,
          timeoutMs: args.timeoutMs ?? null,
          namespaceTools: namespace.toolNames
        }
      });
      try {
        const { value, logs } = await runPtcCell(code, {
          timeoutMs: args.timeoutMs,
          abortController: controller,
          hooks: namespace.bindings
        });
        const executedAt = new Date().toISOString();
        deps.saveProgram?.(context.session.id, {
          ptcLastProgram: code,
          ptcLastExecutedAt: executedAt,
          ptcLastRunOk: true
        });
        deps.emitTrace?.(context.session.id, {
          kind: 'ptc_cell',
          payload: { phase: 'end', ok: true, logs: logs.length }
        });
        return {
          ok: true,
          content: resultJson({ ok: true, result: value, logs, callSite: PTC_EXEC_TOOL_NAME }),
          metadata: {
            ptc: { ok: true, codeChars: code.length, logs: logs.length, executedAt }
          }
        };
      } catch (error) {
        const isolate = error instanceof PtcIsolateError ? error : undefined;
        const message = error instanceof Error ? error.message : String(error);
        deps.saveProgram?.(context.session.id, {
          ptcLastProgram: code,
          ptcLastExecutedAt: new Date().toISOString(),
          ptcLastRunOk: false,
          ptcLastError: message.slice(0, 1000)
        });
        deps.emitTrace?.(context.session.id, {
          kind: 'ptc_cell',
          payload: { phase: 'end', ok: false, code: isolate?.code ?? 'runtime', error: message }
        });
        return {
          ok: false,
          content: resultJson({
            ok: false,
            error: message,
            code: isolate?.code ?? 'runtime',
            logs: [],
            callSite: PTC_EXEC_TOOL_NAME
          })
        };
      } finally {
        context.abortSignal?.removeEventListener('abort', onAbort);
      }
    }
  };
}
