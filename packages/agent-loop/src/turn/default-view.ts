/**
 * Default model view: refusal preservation + micro-compact.
 * Host.prepareMessagesForModel overrides this entirely.
 */

import { applyRefusalPreservationGuard } from '../model/refusal-preservation.js';
import {
  DEFAULT_MICRO_COMPACT_CONFIG,
  microCompactMessages,
  type MicroCompactConfig
} from '../session/micro-compact.js';
import type { SessionMessage } from '../types.js';

export interface DefaultPrepareViewOptions {
  refusalPreservation?: boolean;
  microCompact?: MicroCompactConfig;
}

export function defaultPrepareView(
  messages: SessionMessage[],
  options?: DefaultPrepareViewOptions
): SessionMessage[] {
  let next = messages;
  if (options?.refusalPreservation !== false) {
    next = applyRefusalPreservationGuard(next).messages;
  }
  return microCompactMessages(next, options?.microCompact ?? DEFAULT_MICRO_COMPACT_CONFIG).messages;
}
