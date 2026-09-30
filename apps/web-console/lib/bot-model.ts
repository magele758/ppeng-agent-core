import {
  encodeModelValue,
  isEnvFallbackOption,
  parseSessionModelRef,
  resolvePickerModelRef,
  type ModelPickerOption,
  type ModelRef
} from './model-providers.ts';

/** Bot chats store the pin as `metadata.modelOverride`; absent means "follow the default". */
export function parseBotModelOverride(
  metadata: Record<string, unknown> | undefined
): ModelRef | null {
  const raw = metadata?.modelOverride;
  return parseSessionModelRef({ modelRef: raw }) ?? null;
}

export type BotModelChoice = { value: string; ref: ModelRef | null };

export const BOT_MODEL_FOLLOW_DEFAULT = '';

/** Dropdown values: '' for follow-default, else `providerId::modelId`. Env fallback is never offered. */
export function botModelSelectValue(pinned: ModelRef | null): string {
  return pinned ? encodeModelValue(pinned) : BOT_MODEL_FOLLOW_DEFAULT;
}

export function botModelPickable(options: readonly ModelPickerOption[]): ModelPickerOption[] {
  return options.filter((o) => !isEnvFallbackOption(o));
}

/** True when a saved pin no longer matches any selectable model (provider removed / model disabled). */
export function botModelPinIsStale(
  pinned: ModelRef | null,
  options: readonly ModelPickerOption[]
): boolean {
  if (!pinned) return false;
  return !botModelPickable(options).some(
    (o) => o.providerId === pinned.providerId && o.modelId === pinned.modelId
  );
}

/**
 * Composer selection to adopt after loading a session. A session carrying its own model wins. Without
 * one, switching sessions or lifting a pin resets to null ("follow the default") so a previous chat's
 * model or a stale `modelRef` mirrored from the pin is not sent as an explicit choice; a plain refresh
 * of the same session keeps the user's current pick.
 */
export function resolveLoadedComposerModelRef(input: {
  metadata: Record<string, unknown> | undefined;
  options: readonly ModelPickerOption[];
  catalogDefault: ModelRef | null;
  current: ModelRef | null;
  sameSession: boolean;
  pinLifted: boolean;
}): ModelRef | null {
  const pin = parseBotModelOverride(input.metadata);
  const own = pin ?? parseSessionModelRef(input.metadata);
  if (own && !(input.pinLifted && !pin)) {
    return resolvePickerModelRef(input.options, own, input.catalogDefault);
  }
  return input.sameSession && !input.pinLifted ? input.current : null;
}

/** The composer picker is locked by the session's own pin (bot chats and forks alike). */
export function composerModelLocked(sessionPin: ModelRef | null): boolean {
  return sessionPin !== null;
}
