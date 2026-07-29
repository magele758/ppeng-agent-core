/**
 * Session working log (absorbed from ai-agent-node session/session-working-log.ts).
 *
 * Compaction is lossy by construction: older turns are archived to a transcript
 * file and replaced by one LLM summary. Anything the summary drops is gone from
 * the model's view forever, and long sessions therefore keep re-deriving facts
 * they already established.
 *
 * The working log is the cheap external memory that survives it: an append-only
 * markdown file per session holding only high-signal entries (compact anchors
 * with the archive path, step outcomes). Its tail is injected user-side each
 * turn, so a compacted session still carries a trail of what happened and where
 * the full transcript lives.
 *
 * Append-only and fail-soft: a broken log must never break a turn.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { envBool, envInt } from '../env.js';
import { createLogger } from '../logger.js';

const log = createLogger('working-log');

export type WorkingLogEntryKind = 'compact_anchor' | 'step_outcome' | 'artifact_indexed';

export interface WorkingLogEntry {
  kind: WorkingLogEntryKind;
  content: string;
  /** Tool that produced the entry, when applicable. */
  sourceTool?: string;
  /** Path to an archived transcript / artifact this entry points at. */
  ref?: string;
  /** Defaults to now; injectable for tests. */
  ts?: number;
}

export function workingLogEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return envBool(env, 'RAW_AGENT_WORKING_LOG', true);
}

/** Chars of log tail injected into the prompt. */
export function workingLogTailChars(env: NodeJS.ProcessEnv = process.env): number {
  return envInt(env, 'RAW_AGENT_WORKING_LOG_TAIL_CHARS', 4_000);
}

export const WORKING_LOG_FILENAME = 'working-memory.md';

/** Stable path so future session-resource sync can find it without a registry. */
export function workingLogPath(stateDir: string, sessionId: string): string {
  return join(stateDir, 'working-logs', sessionId, WORKING_LOG_FILENAME);
}

/** Append one entry. Never throws — a failed write only costs context, not the turn. */
export function appendWorkingLogEntry(path: string, entry: WorkingLogEntry): void {
  try {
    const ts = new Date(entry.ts ?? Date.now()).toISOString();
    let header = `\n---\n**[${ts}] ${entry.kind}**`;
    if (entry.sourceTool) header += ` | tool: ${entry.sourceTool}`;
    if (entry.ref) header += ` | ref: \`${entry.ref}\``;
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(path, `${header}\n${entry.content.trim()}\n`, 'utf8');
  } catch (err) {
    log.warn(`working log append failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Read the tail of the log. Missing file → '' (graceful degradation by design). */
export function readWorkingLogTail(path: string, maxChars = 4_000): string {
  try {
    if (!existsSync(path)) return '';
    const content = readFileSync(path, 'utf8');
    if (content.length <= maxChars) return content;
    return `…[${content.length - maxChars} earlier chars truncated]\n${content.slice(-maxChars)}`;
  } catch {
    return '';
  }
}
