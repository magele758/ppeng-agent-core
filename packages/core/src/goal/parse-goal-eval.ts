import type { GoalEvalResult } from './types.js';

/** Parse judge JSON; illegal/missing → undefined (caller fail-opens). */
export function parseGoalEvalJson(text: string): Omit<GoalEvalResult, 'source'> | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  let parsed: unknown;
  try {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    const slice = start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
    parsed = JSON.parse(slice);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const o = parsed as Record<string, unknown>;
  if (typeof o.met !== 'boolean') return undefined;
  const reason = typeof o.reason === 'string' ? o.reason.trim() : '';
  const result: Omit<GoalEvalResult, 'source'> = {
    met: o.met,
    reason: reason || (o.met ? 'goal met' : 'goal not met')
  };
  if (o.progress === 'advanced' || o.progress === 'stalled') result.progress = o.progress;
  if (Array.isArray(o.missing) && o.missing.every((x) => typeof x === 'string')) {
    result.missing = o.missing as string[];
  }
  if (o.missing_kind === 'user' || o.missing_kind === 'tool' || o.missing_kind === 'unknown') {
    result.missingKind = o.missing_kind;
  } else if (o.missingKind === 'user' || o.missingKind === 'tool' || o.missingKind === 'unknown') {
    result.missingKind = o.missingKind;
  }
  if (o.steer_action === 'merge' || o.steer_action === 'supersede') {
    result.steerAction = o.steer_action;
  } else if (o.steerAction === 'merge' || o.steerAction === 'supersede') {
    result.steerAction = o.steerAction;
  }
  return result;
}
