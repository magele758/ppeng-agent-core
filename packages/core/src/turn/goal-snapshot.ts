/**
 * Soft goal-gate snapshot: judge must see the fold view, not WAL.
 * Compact/hide/replace shadow earlier seqs; listing WAL would re-surface them.
 */

import { textSummaryFromParts } from '../model/model-adapters.js';
import type { SessionMessage } from '../types.js';

const DEFAULT_MAX_MESSAGES = 8;
const DEFAULT_MAX_CHARS = 12_000;

export function goalJudgeSnapshotFromMessages(
  messages: SessionMessage[],
  maxMessages = DEFAULT_MAX_MESSAGES,
  maxChars = DEFAULT_MAX_CHARS
): string {
  return messages
    .slice(-maxMessages)
    .map((m) => `${m.role}: ${textSummaryFromParts(m.parts)}`)
    .join('\n')
    .slice(0, maxChars);
}

export function foldGoalJudgeSnapshot(
  store: { foldMessages(sessionId: string): SessionMessage[] },
  sessionId: string,
  maxMessages = DEFAULT_MAX_MESSAGES
): string {
  return goalJudgeSnapshotFromMessages(store.foldMessages(sessionId), maxMessages);
}
