import {
  encodeModelValue,
  isEnvFallbackOption,
  parseSessionModelRef,
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
