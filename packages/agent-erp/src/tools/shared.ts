import type { RunContext, ToolExecutionResult } from '@ppeng/agent-core';
import { ErpStore, getDefaultStore } from '../store.js';

export function resolveStore(context: RunContext): ErpStore {
  return getDefaultStore(context.stateDir);
}

export function okJson(value: unknown): ToolExecutionResult {
  return { ok: true, content: JSON.stringify(value, null, 2) };
}

export function fail(message: string): ToolExecutionResult {
  return { ok: false, content: message };
}

let seq = 0;
export function nextDocId(prefix = 'erp'): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}`;
}
