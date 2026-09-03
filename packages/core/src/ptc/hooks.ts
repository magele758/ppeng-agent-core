import type { RunContext, ToolContract, ToolExecutionResult } from '../types.js';

const JS_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const RESERVED = new Set([
  'agent',
  'scratchpad',
  'verify',
  'console',
  'tools',
  'require',
  'process',
  'fetch',
  'eval',
  'Function',
  'undefined',
  'Promise',
  'Object',
  'Array',
  'JSON',
  'Math',
  'Date'
]);

export const PTC_NAMESPACE_BLOCKED_NAMES = new Set([
  'ptc_exec',
  'spawn_subagent',
  'spawn_teammate',
  'send_message',
  'read_inbox',
  'TodoWrite',
  'task_create',
  'task_update',
  'schedule_social_post',
  'harness_write_spec',
  'memory_set',
  'memory_delete',
  'handoff_state',
  'record_summary',
  'write_file',
  'edit_file',
  'bash',
  'bg_run',
  'spill_tool_result',
  'compact_context',
  'a2ui_render',
  'a2ui_delete_surface'
]);

export interface PtcScratchpad {
  write(key: string, content: unknown): Promise<unknown>;
  read(key: string): Promise<unknown>;
  list(): Promise<unknown>;
}

export interface PtcNamespaceOptions {
  context: RunContext;
  authorizedTools: ToolContract<any>[];
  agent: (spec: unknown) => Promise<unknown>;
  scratchpad: PtcScratchpad;
  verify: (spec: unknown) => Promise<unknown>;
  onToolCall?: (name: string, result: ToolExecutionResult) => void;
}

export interface PtcNamespace {
  bindings: Record<string, unknown>;
  toolNames: string[];
}

export function isPtcNamespaceTool(tool: ToolContract<any>): boolean {
  return (
    tool.ptc?.kind === 'read' &&
    tool.ptc.requiresConfirm !== true &&
    !PTC_NAMESPACE_BLOCKED_NAMES.has(tool.name)
  );
}

function normalizeToolArgs(name: string, raw: unknown): Record<string, unknown> {
  if (name === 'web_search' && typeof raw === 'string') return { query: raw };
  if (name === 'web_fetch' && typeof raw === 'string') return { url: raw };
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${name}() expects an object argument`);
  }
  return raw as Record<string, unknown>;
}

function readonlyToolHook(
  tool: ToolContract<any>,
  context: RunContext,
  onToolCall?: (name: string, result: ToolExecutionResult) => void
): (raw?: unknown) => Promise<ToolExecutionResult> {
  return async (raw?: unknown) => {
    if (context.abortSignal?.aborted) throw new Error('PTC cell aborted');
    const result = await tool.execute(context, normalizeToolArgs(tool.name, raw));
    onToolCall?.(tool.name, result);
    return result;
  };
}

/** Build the cell namespace exclusively from this turn's authorized read surface. */
export function buildPtcNamespace(options: PtcNamespaceOptions): PtcNamespace {
  const bindings: Record<string, unknown> = Object.create(null);
  const toolsBag: Record<string, unknown> = Object.create(null);
  const names: string[] = [];

  bindings.agent = options.agent;
  bindings.scratchpad = Object.freeze({
    write: options.scratchpad.write,
    read: options.scratchpad.read,
    list: options.scratchpad.list
  });
  bindings.verify = options.verify;

  for (const tool of options.authorizedTools) {
    if (!isPtcNamespaceTool(tool)) continue;
    const hook = readonlyToolHook(tool, options.context, options.onToolCall);
    toolsBag[tool.name] = hook;
    names.push(tool.name);
    if (JS_IDENTIFIER.test(tool.name) && !RESERVED.has(tool.name)) {
      bindings[tool.name] = hook;
    }
  }
  bindings.tools = Object.freeze(toolsBag);
  return { bindings, toolNames: names.sort() };
}
