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
