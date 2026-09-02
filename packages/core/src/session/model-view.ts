/**
 * Read-only model view of a stored transcript.
 *
 * Uses the same `resolveMicroCompactConfig` + `microCompactMessages` path as
 * `prepareMessagesForModel` so Lab can preview placeholders without writing
 * SQLite. Chat Completions still cannot evict mid-stream; this is the next
 * request's view.
 */

import {
  microCompactMessages,
  type MicroCompactConfig,
  type MicroCompactPolicy,
  type MicroCompactStats
} from './micro-compact.js';
import { resolveMicroCompactConfig } from './compact-settings.js';
import type { SessionMessage } from '../types.js';

export interface SessionModelView {
  stored: SessionMessage[];
  modelView: SessionMessage[];
  stats: MicroCompactStats;
  policy: MicroCompactPolicy;
}

export function buildSessionModelView(input: {
  messages: SessionMessage[];
  store?: { getDaemonControl?(key: string): unknown };
  env?: NodeJS.ProcessEnv;
  /** Test override; production callers omit this and use Lab KV + env. */
  config?: MicroCompactConfig;
}): SessionModelView {
  const config =
    input.config ??
    resolveMicroCompactConfig({
      store: input.store,
      env: input.env ?? process.env
    });
  const { messages: modelView, stats } = microCompactMessages(input.messages, config);
  return {
    stored: input.messages,
    modelView,
    stats,
    policy: config.policy ?? 'keep_recent'
  };
}
