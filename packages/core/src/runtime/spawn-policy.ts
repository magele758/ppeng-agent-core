import { readSessionModelOverride, type SessionModelOverride } from '../model/provider-catalog.js';

/**
 * Subagent inheritance. Bot parents do not pass bypass/auto down, and do not
 * copy the whole scratch pad unless the caller already supplied a key filter.
 */

export function isBotParentSession(metadata: Record<string, unknown> | undefined): boolean {
  if (!metadata) return false;
  if (metadata.canonicalBotChat === true) return true;
  const botId = metadata.botId;
  return typeof botId === 'string' && botId.trim().length > 0;
}

/** Child permissionMode. Undefined means "do not set" (same as a parent with no mode). */
export function childPermissionMode(
  metadata: Record<string, unknown> | undefined
): string | undefined {
  const raw = metadata?.permissionMode;
  const parentMode = typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
  if (!isBotParentSession(metadata)) return parentMode;
  if (parentMode === 'bypass' || parentMode === 'auto') return 'ask';
  return parentMode;
}

export function copyScratchOnSpawn(
  metadata: Record<string, unknown> | undefined,
  scratchKeyFilter: ((key: string) => boolean) | undefined
): 'all' | 'filter' | 'skip' {
  if (isBotParentSession(metadata)) {
    return scratchKeyFilter ? 'filter' : 'skip';
  }
  return scratchKeyFilter ? 'filter' : 'all';
}

/**
 * Children follow the parent's model pin (Bot setting or an inherited
 * spawn_subagent `model`). Empty when the parent has none. An explicit
 * `model` passed to spawn_subagent is applied by the caller and wins.
 */
export function inheritModelOverride(
  metadata: Record<string, unknown> | undefined
): { modelOverride?: SessionModelOverride } {
  const pinned = readSessionModelOverride(metadata);
  return pinned ? { modelOverride: pinned } : {};
}

/**
 * Teammates from non-Bot parents keep today's behavior (no inherited mode). A
 * Bot parent passes its mode down through the same downgrade as subagents, so
 * a plan/ask Bot cannot fall back to the auto default via a teammate.
 */
export function botTeammatePermission(
  metadata: Record<string, unknown> | undefined
): { permissionMode?: string } {
  if (!isBotParentSession(metadata)) return {};
  const mode = childPermissionMode(metadata);
  return mode ? { permissionMode: mode } : {};
}
