/**
 * A2UI v0.9 data-binding helpers.
 *
 * Implements the JSON-Pointer reference resolver (RFC 6901) plus A2UI's
 * relative-path extension (paths that don't start with "/" are resolved
 * against the active iteration scope when inside a List/Column template).
 *
 * Dynamic* values can be:
 *  - a literal of the value's natural type
 *  - { path: "/...|relative" }
 *  - { call: "fnName", args?: {...} }   ← we currently treat function calls
 *    as opaque and return a string serialization; full function-call evaluator
 *    is a future-extension hook (mirror catalog-side functions).
 */

export type DynamicLike =
  | unknown
  | { path: string }
  | { call: string; args?: Record<string, unknown> };

export interface BindingScope {
  /** Pointer to the array item the current template iteration is bound to (e.g. "/users/2"). */
  templatePath?: string;
  /** Index in the array (for ${index} substitutions). */
  templateIndex?: number;
}

const ROOT_SCOPE: BindingScope = {};

/** Decode a single JSON Pointer reference token (RFC 6901 §4). */
function decodePointerToken(raw: string): string {
  return raw.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Resolve a JSON Pointer against `model`. Returns undefined for missing keys. */
export function resolveJsonPointer(model: unknown, pointer: string): unknown {
  if (pointer === '' || pointer === '/') return model;
  if (!pointer.startsWith('/')) return undefined;
  const tokens = pointer.slice(1).split('/').map(decodePointerToken);
  let cursor: unknown = model;
  for (const token of tokens) {
    if (cursor === null || cursor === undefined) return undefined;
    if (Array.isArray(cursor)) {
      const idx = Number(token);
      if (!Number.isFinite(idx)) return undefined;
      cursor = cursor[idx];
    } else if (typeof cursor === 'object') {
      cursor = (cursor as Record<string, unknown>)[token];
    } else {
      return undefined;
    }
  }
  return cursor;
}

/** Compose a relative path with the current scope. Absolute paths win. */
export function resolveScopedPath(path: string, scope: BindingScope = ROOT_SCOPE): string {
  if (path.startsWith('/')) return path;
  if (!scope.templatePath) return `/${path}`;
  return `${scope.templatePath}/${path}`;
}

/** Detect a Dynamic* "{ path }" reference. */
export function isPathRef(value: unknown): value is { path: string } {
  return Boolean(
    value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { path?: unknown }).path === 'string'
  );
}

/** Detect a Dynamic* "{ call }" reference. */
export function isCallRef(value: unknown): value is { call: string; args?: Record<string, unknown> } {
  return Boolean(
    value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { call?: unknown }).call === 'string'
  );
}

/**
 * Evaluate a Dynamic* value against the model + current scope.
 * Returns the literal for raw values, the resolved data for path refs,
 * and a stringified call descriptor for unknown function calls.
 */
export function evalDynamic(value: DynamicLike, model: unknown, scope: BindingScope = ROOT_SCOPE): unknown {
  if (isPathRef(value)) {
    return resolveJsonPointer(model, resolveScopedPath(value.path, scope));
  }
  if (isCallRef(value)) {
    // Local function call evaluator hook — register implementations here as
    // the catalog grows (formatDate, openUrl, etc.).
    return evalFunctionCall(value, model, scope);
  }
  return value;
}

function evalFunctionCall(
  ref: { call: string; args?: Record<string, unknown> },
  model: unknown,
  scope: BindingScope
): unknown {
  const args: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ref.args ?? {})) {
    args[k] = evalDynamic(v, model, scope);
  }
  switch (ref.call) {
    case 'formatDate': {
      const v = args.value;
      const d = typeof v === 'string' || typeof v === 'number' ? new Date(v) : v instanceof Date ? v : null;
      if (!d || Number.isNaN(d.getTime())) return '';
      return d.toLocaleString();
    }
    case 'concat':
      return Array.isArray(args.values) ? args.values.map(stringifyForRender).join('') : '';
    default:
      return `[fn ${ref.call}]`;
  }
}

/** Convert any resolved value to the string A2UI's text components expect. */
export function stringifyForRender(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Convenience: dynamic-string evaluator. */
export function evalDynamicString(value: DynamicLike, model: unknown, scope: BindingScope = ROOT_SCOPE): string {
  return stringifyForRender(evalDynamic(value, model, scope));
}

/** Convenience: dynamic-boolean evaluator (truthy semantics). */
export function evalDynamicBoolean(value: DynamicLike, model: unknown, scope: BindingScope = ROOT_SCOPE): boolean {
  const v = evalDynamic(value, model, scope);
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.length > 0 && v !== 'false';
  if (typeof v === 'number') return v !== 0;
  return Boolean(v);
}

/** Set a value at a JSON Pointer, creating intermediate objects as needed. */
export function setAtPointer(model: unknown, pointer: string, value: unknown): unknown {
  if (pointer === '' || pointer === '/') return value;
  if (!pointer.startsWith('/')) return model;
  const tokens = pointer.slice(1).split('/').map(decodePointerToken);
  const root = isObject(model) ? clone(model) : {};
  let cursor: Record<string, unknown> | unknown[] = root as Record<string, unknown>;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const token = tokens[i] as string;
    const nextValue: unknown = (cursor as Record<string, unknown>)[token];
    if (Array.isArray(nextValue)) {
      const copy = [...nextValue];
      (cursor as Record<string, unknown>)[token] = copy;
      cursor = copy;
    } else if (nextValue && typeof nextValue === 'object') {
      const copy = { ...(nextValue as Record<string, unknown>) };
      (cursor as Record<string, unknown>)[token] = copy;
      cursor = copy;
    } else {
      const fresh: Record<string, unknown> = {};
      (cursor as Record<string, unknown>)[token] = fresh;
      cursor = fresh;
    }
  }
  const lastToken = tokens[tokens.length - 1] as string;
  if (Array.isArray(cursor)) {
    const idx = Number(lastToken);
    if (Number.isFinite(idx)) (cursor as unknown[])[idx] = value;
  } else {
    (cursor as Record<string, unknown>)[lastToken] = value;
  }
  return root;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => clone(v)) as unknown as T;
  if (isObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = clone(v);
    return out as unknown as T;
  }
  return value;
}
