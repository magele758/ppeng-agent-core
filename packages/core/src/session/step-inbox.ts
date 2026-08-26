import { DatabaseSync } from 'node:sqlite';
import { createId, nowIso } from '../id.js';

export type InboxTarget = 'next-step' | 'next-run';
export type InboxRole = 'user' | 'system';

export interface InboxItem {
  id: string;
  sessionId: string;
  target: InboxTarget;
  role: InboxRole;
  text: string;
  key?: string;
  createdAt: string;
  claimedAt?: string;
}

export interface EnqueueSteerOptions {
  target?: InboxTarget;
  key?: string;
  role?: InboxRole;
}

/**
 * Step inbox: user steer that lands on the *next* model shot, never mutating
 * an in-flight HTTP request. Same `key` overwrites — only the latest unclaimed
 * item with that key is claimed.
 */
export class StepInboxStore {
  constructor(private readonly db: DatabaseSync) {}

  enqueue(sessionId: string, text: string, opts: EnqueueSteerOptions = {}): InboxItem {
    const item: InboxItem = {
      id: createId('steer'),
      sessionId,
      target: opts.target ?? 'next-step',
      role: opts.role ?? 'user',
      text,
      key: opts.key,
      createdAt: nowIso()
    };
    this.db
      .prepare(
        `INSERT INTO session_inbox (id, session_id, target, role, text, key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.id,
        item.sessionId,
        item.target,
        item.role,
        item.text,
        item.key ?? null,
        item.createdAt
      );
    return item;
  }

  /**
   * Claim unclaimed items for `target`. Same-key items: only the latest
   * (created_at, id) is returned; older unclaimed siblings are marked claimed
   * without being applied.
   */
  claim(sessionId: string, target: InboxTarget): InboxItem[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM session_inbox
         WHERE session_id = ? AND target = ? AND claimed_at IS NULL
         ORDER BY rowid ASC`
      )
      .all(sessionId, target) as Array<Record<string, unknown>>;

    const items = rows.map(mapInboxRow);
    const latestByKey = new Map<string, InboxItem>();
    const keyedSkipped: InboxItem[] = [];
    const unkeyed: InboxItem[] = [];
    for (const item of items) {
      if (!item.key) {
        unkeyed.push(item);
        continue;
      }
      const prev = latestByKey.get(item.key);
      if (prev) keyedSkipped.push(prev);
      latestByKey.set(item.key, item);
    }

    const claimedAt = nowIso();
    const apply = [...unkeyed, ...latestByKey.values()].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
    );
    const mark = this.db.prepare(`UPDATE session_inbox SET claimed_at = ? WHERE id = ?`);
    for (const item of [...apply, ...keyedSkipped]) {
      mark.run(claimedAt, item.id);
      item.claimedAt = claimedAt;
    }
    return apply;
  }

  listUnclaimed(sessionId: string): InboxItem[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM session_inbox
         WHERE session_id = ? AND claimed_at IS NULL
         ORDER BY created_at ASC, id ASC`
      )
      .all(sessionId) as Array<Record<string, unknown>>;
    return rows.map(mapInboxRow);
  }
}

function mapInboxRow(row: Record<string, unknown>): InboxItem {
  const key = row.key == null || row.key === '' ? undefined : String(row.key);
  const claimedAt = row.claimed_at == null ? undefined : String(row.claimed_at);
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    target: row.target === 'next-run' ? 'next-run' : 'next-step',
    role: row.role === 'system' ? 'system' : 'user',
    text: String(row.text),
    key,
    createdAt: String(row.created_at),
    claimedAt
  };
}
