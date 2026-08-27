/**
 * Evolving coach query text: fold view, not WAL listMessages().slice.
 * Compacted / hidden rows must not leak back into the recall query.
 */

import { textSummaryFromParts } from '../model/model-adapters.js';
import type { SessionMessage } from '../types.js';

const DEFAULT_MAX_MESSAGES = 12;
const DEFAULT_MAX_CHARS = 12_000;

export function evolvingQueryTextFromMessages(
  messages: SessionMessage[],
  maxMessages = DEFAULT_MAX_MESSAGES,
  maxChars = DEFAULT_MAX_CHARS
): string {
  const msgs = messages.slice(-maxMessages);
  const lines: string[] = [];
  for (const m of msgs) {
    const sum = textSummaryFromParts(m.parts).trim();
    if (!sum) continue;
    lines.push(`${m.role}: ${sum}`);
  }
  return lines.join('\n').slice(0, maxChars);
}

export function evolvingQueryText(
  store: { foldMessages(sessionId: string): SessionMessage[] },
  sessionId: string,
  maxMessages = DEFAULT_MAX_MESSAGES
): string {
  return evolvingQueryTextFromMessages(store.foldMessages(sessionId), maxMessages);
}
