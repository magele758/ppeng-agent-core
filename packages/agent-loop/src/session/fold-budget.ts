/**
 * Compact fold-budget clamp (from B prepare-view / auto-compact).
 * Pure: no store, no episodic selection.
 */

import { envInt } from '../helpers.js';

export const MAX_VISIBLE_MESSAGES = 24;

/**
 * Keep-recent clamp used by closed-prefix compact:
 * never keep the entire fold, never keep more than `keepRecent`.
 */
export function clampFoldKeepRecent(length: number, keepRecent: number): number {
  return Math.min(keepRecent, Math.max(1, length - 1));
}

/** Tail-slice a fold that exceeds the visible-message budget. */
export function clampFoldToVisible<T>(folded: readonly T[], maxVisible = MAX_VISIBLE_MESSAGES): T[] {
  if (folded.length <= maxVisible) return folded.slice();
  return folded.slice(-maxVisible);
}

export function capRollingSummaryText(text: string, maxChars: number): string {
  if (maxChars <= 0) {
    return '';
  }
  if (text.length <= maxChars) {
    return text;
  }
  return `…[earlier summary truncated]\n\n${text.slice(-maxChars)}`;
}

/**
 * 摘要字符上限：未设置 RAW_AGENT_COMPACT_SUMMARY_MAX_CHARS 时 = 阈值×2
 *（est≈len/4，约为阈值一半预算给摘要，余量给最近 N 条）。
 */
export function compactSummaryMaxChars(env: NodeJS.ProcessEnv, tokenThreshold: number): number {
  return envInt(env, 'RAW_AGENT_COMPACT_SUMMARY_MAX_CHARS', tokenThreshold * 2);
}
