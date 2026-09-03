import vm from 'node:vm';
import type { PtcCellResult, PtcIsolateErrorCode } from './types.js';

export const DEFAULT_PTC_TIMEOUT_MS = 120_000;
export const MIN_PTC_TIMEOUT_MS = 10;
export const MAX_PTC_CODE_CHARS = 60_000;

export class PtcIsolateError extends Error {
  readonly code: PtcIsolateErrorCode;

  constructor(message: string, code: PtcIsolateErrorCode) {
    super(message);
    this.name = 'PtcIsolateError';
    this.code = code;
  }
}

export function clampPtcTimeoutMs(raw?: number): number {
  if (raw == null || !Number.isFinite(raw)) return DEFAULT_PTC_TIMEOUT_MS;
  return Math.min(DEFAULT_PTC_TIMEOUT_MS, Math.max(MIN_PTC_TIMEOUT_MS, Math.floor(raw)));
}

export interface PtcIsolateOptions {
  timeoutMs?: number;
  abortController?: AbortController;
  hooks: Record<string, unknown>;
}

const MAX_CONSOLE_LINE = 500;
const MAX_CONSOLE_LINES = 80;
const STATEMENT_LAST =
  /^(const|let|var|if|for|while|switch|try|throw|class|function|async\s+function|do|break|continue|debugger|return)\b/;

export function wrapPtcCellSource(code: string): string {
  const source = String(code ?? '').trim();
  if (!source) throw new PtcIsolateError('PTC cell code is empty', 'runtime');
  if (source.length > MAX_PTC_CODE_CHARS) {
    throw new PtcIsolateError(
      `PTC cell exceeds ${MAX_PTC_CODE_CHARS} characters`,
      'forbidden'
    );
  }
  const lines = source.split('\n');
  let lastIndex = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i]!.trim()) {
      lastIndex = i;
      break;
    }
  }
  if (lastIndex >= 0) {
    const last = lines[lastIndex]!.trim();
    if (
      !/\breturn\b/.test(last) &&
      !STATEMENT_LAST.test(last) &&
      last !== '}' &&
      !last.endsWith('{')
    ) {
      const expression = last.replace(/;+\s*$/, '');
      if (expression) lines[lastIndex] = `return (${expression});`;
    }
  }
  return `'use strict'; (async () => {\n${lines.join('\n')}\n})()`;
}

function stringifyLog(args: unknown[]): string {
  const text = args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
  return text.length > MAX_CONSOLE_LINE ? `${text.slice(0, MAX_CONSOLE_LINE)}…` : text;
}

function forbidden(name: string): () => never {
  return () => {
    // Throw a primitive: exposing a host Error object to node:vm would expose
    // its host-realm constructor chain to code inside the cell.
    throw `PTC_FORBIDDEN:${name}`;
  };
}

const BLOCKED_FUNCTION_PROPERTIES = new Set([
  'constructor',
  'prototype',
  '__proto__',
  'caller',
  'callee',
  'arguments'
]);

function sandboxValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return String(value);
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) {
    const items = value.map((item) => sandboxValue(item, seen));
    Object.setPrototypeOf(items, null);
    return Object.freeze(items);
  }
  const out: Record<string, unknown> = Object.create(null);
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    out[key] = sandboxValue(item, seen);
  }
  return Object.freeze(out);
}

function safeCallable(fn: (...args: unknown[]) => unknown): (...args: unknown[]) => unknown {
  const callable = (...args: unknown[]) => fn(...args);
  return new Proxy(callable, {
    get(_target, property) {
      if (typeof property === 'string' && BLOCKED_FUNCTION_PROPERTIES.has(property)) {
        throw `PTC_FORBIDDEN:function.${property}`;
      }
      return undefined;
    },
    getPrototypeOf() {
      return null;
    },
    set() {
      return false;
    },
    defineProperty() {
      return false;
    },
    deleteProperty() {
      return false;
    }
  });
}

/** Promise-compatible null-prototype wrapper; the host Promise never enters the VM. */
function safeThenable(promise: Promise<unknown>): Record<string, unknown> {
  const thenable: Record<string, unknown> = Object.create(null);
  thenable.then = safeCallable((resolve, reject) => {
    const onResolve = typeof resolve === 'function' ? resolve : () => undefined;
    const onReject = typeof reject === 'function' ? reject : () => undefined;
    promise.then(
      (value) => onResolve(sandboxValue(value)),
      (error) => onReject(error instanceof Error ? error.message : String(error))
    );
  });
  return Object.freeze(thenable);
}

function safeHook(fn: (...args: unknown[]) => unknown): (...args: unknown[]) => unknown {
  return safeCallable((...args: unknown[]) =>
    safeThenable(Promise.resolve().then(() => fn(...args)))
  );
}

function safeHookValue(value: unknown): unknown {
  if (typeof value === 'function') return safeHook(value as (...args: unknown[]) => unknown);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return sandboxValue(value);
  const out: Record<string, unknown> = Object.create(null);
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = safeHookValue(item);
  }
  return Object.freeze(out);
}

function createSandbox(hooks: Record<string, unknown>, logs: string[]): Record<string, unknown> {
  const sandbox: Record<string, unknown> = Object.create(null);
  const pushLog = (...args: unknown[]) => {
    if (logs.length < MAX_CONSOLE_LINES) logs.push(stringifyLog(args));
  };
  Object.defineProperty(sandbox, 'console', {
    value: Object.freeze({
      log: pushLog,
      info: pushLog,
      warn: pushLog,
      error: pushLog,
      debug: pushLog
    }),
    writable: false,
    configurable: false
  });
  for (const [name, value] of Object.entries(hooks)) {
    if (Object.prototype.hasOwnProperty.call(sandbox, name)) continue;
    Object.defineProperty(sandbox, name, {
      value: safeHookValue(value),
      writable: false,
      configurable: false,
      enumerable: true
    });
  }
  for (const name of [
    'require',
    'process',
    'fetch',
    'eval',
    'Function',
    'WebAssembly',
    'global',
    'module',
    'exports',
    'Buffer'
  ]) {
    Object.defineProperty(sandbox, name, {
      get: forbidden(name),
      set: forbidden(name),
      configurable: false
    });
  }
  return Object.freeze(sandbox);
}

function classifyPtcError(error: unknown): PtcIsolateError {
  if (error instanceof PtcIsolateError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : '';
  if (name === 'AbortError' || /aborted/i.test(message)) {
    return new PtcIsolateError(message, 'aborted');
  }
  if (
    /PTC_FORBIDDEN|cannot use|dynamic import|ERR_VM_DYNAMIC_IMPORT|codeGeneration|require|process|fetch/i.test(
      message
    )
  ) {
    return new PtcIsolateError(message, 'forbidden');
  }
  return new PtcIsolateError(message, 'runtime');
}

export async function runPtcCell(
  code: string,
  options: PtcIsolateOptions
): Promise<PtcCellResult> {
  const timeoutMs = clampPtcTimeoutMs(options.timeoutMs);
  const abortController = options.abortController ?? new AbortController();
  if (abortController.signal.aborted) {
    throw new PtcIsolateError('PTC cell aborted', 'aborted');
  }

  const logs: string[] = [];
  const context = vm.createContext(createSandbox(options.hooks, logs), {
    name: 'ptc-cell',
    codeGeneration: { strings: false, wasm: false }
  });

  let script: vm.Script;
  try {
    script = new vm.Script(wrapPtcCellSource(code), {
      filename: 'ptc-cell.js',
      importModuleDynamically: (async () => {
        throw new PtcIsolateError('PTC cell cannot use dynamic import', 'forbidden');
      }) as never
    });
  } catch (error) {
    throw classifyPtcError(error);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      abortController.abort();
      reject(new PtcIsolateError(`PTC cell timed out after ${timeoutMs}ms`, 'timeout'));
    }, timeoutMs);
  });
  try {
    const value = script.runInContext(context, {
      timeout: Math.min(timeoutMs, 5_000),
      breakOnSigint: false
    });
    return { value: await Promise.race([Promise.resolve(value), timeout]), logs };
  } catch (error) {
    throw classifyPtcError(error);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const runPtcProgram = runPtcCell;
