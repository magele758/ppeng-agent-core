/**
 * Prompt-cache helpers: stable toolset lock + cache key for provider affinity.
 *
 * Mid-session toolset swaps break provider KV cache. We fingerprint the tool
 * names exposed on the first turn and refuse silent drift (or re-lock only after compact).
 */

import { createHash } from 'node:crypto';

export const TOOLSET_LOCK_META_KEY = 'promptCacheToolsetFingerprint';
export const PROMPT_CACHE_KEY_META = 'promptCacheKey';

/** Hard invariant: once locked, toolset must not change without an explicit bust. */
export class PromptCacheInvariantError extends Error {
  readonly code = 'PROMPT_CACHE_TOOLSET_DRIFT';
  constructor(
    message: string,
    readonly locked: string,
    readonly current: string
  ) {
    super(message);
    this.name = 'PromptCacheInvariantError';
  }
}

export function fingerprintToolNames(toolNames: string[]): string {
  const sorted = [...new Set(toolNames)].map((n) => n.trim()).filter(Boolean).sort();
  return createHash('sha256').update(sorted.join('\n')).digest('hex').slice(0, 24);
}

export function buildPromptCacheKey(sessionId: string, toolsetFingerprint: string): string {
  return `ppeng:${sessionId}:${toolsetFingerprint}`;
}

export interface ToolsetLockResult {
  fingerprint: string;
  promptCacheKey: string;
  /** True when fingerprint changed vs locked value */
  drifted: boolean;
  /** Metadata patch to persist on the session */
  metadataPatch: Record<string, unknown>;
}

/**
 * Lock toolset on first use; report drift if later turns expose a different set.
 * Callers may still proceed on drift (e.g. optional groups toggled) but should
 * treat it as a cache-busting event.
 */
export function resolveToolsetLock(
  sessionId: string,
  toolNames: string[],
  metadata: Record<string, unknown> | undefined
): ToolsetLockResult {
  const fingerprint = fingerprintToolNames(toolNames);
  const promptCacheKey = buildPromptCacheKey(sessionId, fingerprint);
  const locked =
    typeof metadata?.[TOOLSET_LOCK_META_KEY] === 'string'
      ? String(metadata[TOOLSET_LOCK_META_KEY])
      : undefined;

  if (!locked) {
    return {
      fingerprint,
      promptCacheKey,
      drifted: false,
      metadataPatch: {
        [TOOLSET_LOCK_META_KEY]: fingerprint,
        [PROMPT_CACHE_KEY_META]: promptCacheKey
      }
    };
  }

  const drifted = locked !== fingerprint;
  return {
    fingerprint,
    promptCacheKey: drifted
      ? buildPromptCacheKey(sessionId, fingerprint)
      : typeof metadata?.[PROMPT_CACHE_KEY_META] === 'string'
        ? String(metadata[PROMPT_CACHE_KEY_META])
        : buildPromptCacheKey(sessionId, locked),
    drifted,
    metadataPatch: drifted
      ? {
          [TOOLSET_LOCK_META_KEY]: fingerprint,
          [PROMPT_CACHE_KEY_META]: buildPromptCacheKey(sessionId, fingerprint),
          promptCacheBustedAt: new Date().toISOString()
        }
      : {}
  };
}

/**
 * Assert toolset stability. When `strict` and drift is detected, throws
 * {@link PromptCacheInvariantError}. Use in tests and optional runtime gate
 * (`RAW_AGENT_PROMPT_CACHE_STRICT=1`).
 */
export function assertToolsetInvariant(
  sessionId: string,
  toolNames: string[],
  metadata: Record<string, unknown> | undefined,
  opts?: { strict?: boolean }
): ToolsetLockResult {
  const result = resolveToolsetLock(sessionId, toolNames, metadata);
  if (result.drifted && opts?.strict) {
    const locked = String(metadata?.[TOOLSET_LOCK_META_KEY] ?? '');
    throw new PromptCacheInvariantError(
      `Prompt-cache invariant violated: toolset drifted mid-session ${sessionId} (locked=${locked}, current=${result.fingerprint})`,
      locked,
      result.fingerprint
    );
  }
  return result;
}

/** True when env requests fail-closed on mid-session toolset drift. */
export function promptCacheStrictFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.RAW_AGENT_PROMPT_CACHE_STRICT?.trim();
  return v === '1' || v?.toLowerCase() === 'true';
}
