/**
 * Per-Bot model pin. Stored as `metadata.modelOverride` (a ModelRef) on the
 * Bot's canonical chats, next to maxTurns / allowedTools. Empty means "follow
 * the global default". Only models already in the Lab picker list are accepted.
 */

import { ValidationError } from '../errors.js';
import { parseModelRef, type ModelRef } from '../model/provider-catalog.js';

export const BOT_MODEL_OVERRIDE_META = 'modelOverride';

/** `null` clears the pin; a ModelRef must be one of `options`. */
export function normalizeBotModelOverride(
  raw: unknown,
  options: readonly { providerId: string; modelId: string }[]
): ModelRef | null {
  if (raw === null || raw === '') return null;
  const ref = parseModelRef(raw);
  if (!ref) {
    throw new ValidationError('modelOverride must be null or { providerId, modelId }');
  }
  const known = options.some((o) => o.providerId === ref.providerId && o.modelId === ref.modelId);
  if (!known) {
    throw new ValidationError(`Unknown model: ${ref.providerId}/${ref.modelId}`);
  }
  return ref;
}

/** Pinned ref on a Bot chat, or undefined when it follows the default. */
export function readBotModelOverride(
  metadata: Record<string, unknown> | undefined
): ModelRef | undefined {
  return parseModelRef(metadata?.[BOT_MODEL_OVERRIDE_META]);
}
