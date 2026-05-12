import type { SessionRecord } from './types.js';

/** Minimal fields used for substring discovery (matches API summaries + full records). */
export type SessionSearchable = Pick<SessionRecord, 'id' | 'title' | 'agentId' | 'status' | 'mode'> &
  Partial<Pick<SessionRecord, 'summary' | 'taskId' | 'parentSessionId' | 'workspaceId'>>;

/**
 * Narrow sessions by a case-insensitive substring match across common fields
 * (id, title, agent, status, mode, summary, linked ids). Empty `q` returns
 * all sessions unchanged — useful for poll endpoints and CLI/UIs that want
 * lightweight "shop floor" discoverability without full-text search.
 */
export function filterSessionsByQuery<T extends SessionSearchable>(sessions: readonly T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [...sessions];
  return sessions.filter((s) => {
    const hay = [
      s.id,
      s.title,
      s.agentId,
      s.status,
      s.mode,
      s.summary ?? '',
      s.taskId ?? '',
      s.parentSessionId ?? '',
      s.workspaceId ?? ''
    ]
      .join('\n')
      .toLowerCase();
    return hay.includes(needle);
  });
}
