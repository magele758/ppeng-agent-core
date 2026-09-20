/**
 * Reject unparsed / non-object tool arguments before execute (normal+).
 * `parseModelToolArguments` may leave `{ raw }` or `{ _nonObject }`.
 */

export type DirtyInputGateResult =
  | { ok: true }
  | { ok: false; reason: string; code: 'DIRTY_TOOL_ARGS_RAW' | 'DIRTY_TOOL_ARGS_NON_OBJECT' };

export function gateDirtyToolInput(input: Record<string, unknown> | undefined | null): DirtyInputGateResult {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      code: 'DIRTY_TOOL_ARGS_NON_OBJECT',
      reason: 'tool arguments were not a JSON object',
    };
  }
  const keys = Object.keys(input);
  if (keys.length === 1 && keys[0] === 'raw') {
    return {
      ok: false,
      code: 'DIRTY_TOOL_ARGS_RAW',
      reason: 'unparsed tool arguments (raw JSON)',
    };
  }
  if ('_nonObject' in input) {
    return {
      ok: false,
      code: 'DIRTY_TOOL_ARGS_NON_OBJECT',
      reason: 'tool arguments were not a JSON object',
    };
  }
  return { ok: true };
}
