import type { DatabaseSync } from 'node:sqlite';
import { createId, nowIso } from '../id.js';
import { parseJson, serializeJson } from '../stores/storage-helpers.js';
import type {
  GoalCloseReason,
  GoalLedgerEntry,
  GoalRecord,
  GoalSpec,
  GoalStatusValue
} from './types.js';
import { parseGoalVerifySpec } from './verify-spec.js';
import {
  closeReasonForEvent,
  transitionGoal,
  type GoalTransitionEvent
} from './goal-state-machine.js';

const LEDGER_HEAD = 1;
const LEDGER_TAIL = 20;

export function trimGoalLedger(ledger: GoalLedgerEntry[]): GoalLedgerEntry[] {
  const cap = LEDGER_HEAD + LEDGER_TAIL;
  if (ledger.length <= cap) return ledger;
  return [...ledger.slice(0, LEDGER_HEAD), ...ledger.slice(ledger.length - LEDGER_TAIL)];
}

export function upgradeGoalRecord(raw: unknown): GoalRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as GoalRecord;
  if (rec.version !== 1) return null;
  if (!rec.goalId || !rec.sessionId || !rec.status) return null;
  if (!Array.isArray(rec.ledger)) rec.ledger = [];
  if (!rec.spec || typeof rec.spec !== 'object') {
    rec.spec = { goal: '', criteria: [], source: 'explicit' };
  }
  if (!Array.isArray(rec.spec.criteria)) rec.spec.criteria = [];
  if (rec.spec.verify !== undefined) {
    const parsed = parseGoalVerifySpec(rec.spec.verify);
    if (parsed) rec.spec.verify = parsed;
    else delete rec.spec.verify;
  }
  return rec;
}

export function createGoalRecord(init: {
  goalId?: string;
  sessionId: string;
  status?: Extract<GoalStatusValue, 'deriving' | 'active'>;
  spec: GoalSpec;
  condition: string;
  maxTurns: number;
}): GoalRecord {
  const now = nowIso();
  return {
    version: 1,
    goalId: init.goalId ?? createId('goal'),
    sessionId: init.sessionId,
    status: init.status ?? 'active',
    spec: init.spec,
    condition: init.condition,
    turnsUsed: 0,
    maxTurns: init.maxTurns,
    ledger: [],
    createdAt: now,
    updatedAt: now
  };
}

export class GoalStore {
  constructor(private readonly db: DatabaseSync) {}

  upsert(record: GoalRecord): void {
    const rec = { ...record, updatedAt: nowIso(), ledger: trimGoalLedger(record.ledger) };
    this.db
      .prepare(
        `
        INSERT INTO goal_records
          (goal_id, session_id, status, close_reason, spec_json, condition,
           turns_used, max_turns, missing_json, criteria_status_json, ledger_json,
           created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(goal_id) DO UPDATE SET
          session_id = excluded.session_id,
          status = excluded.status,
          close_reason = excluded.close_reason,
          spec_json = excluded.spec_json,
          condition = excluded.condition,
          turns_used = excluded.turns_used,
          max_turns = excluded.max_turns,
          missing_json = excluded.missing_json,
          criteria_status_json = excluded.criteria_status_json,
          ledger_json = excluded.ledger_json,
          updated_at = excluded.updated_at
      `
      )
      .run(
        rec.goalId,
        rec.sessionId,
        rec.status,
        rec.closeReason ?? null,
        serializeJson(rec.spec),
        rec.condition,
        rec.turnsUsed,
        rec.maxTurns,
        rec.missing != null ? serializeJson(rec.missing) : null,
        rec.criteriaStatus != null ? serializeJson(rec.criteriaStatus) : null,
        serializeJson(rec.ledger),
        rec.createdAt,
        rec.updatedAt
      );
  }

  get(goalId: string): GoalRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM goal_records WHERE goal_id = ?`)
      .get(goalId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findLatestBySession(sessionId: string): GoalRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM goal_records WHERE session_id = ? ORDER BY updated_at DESC LIMIT 1`)
      .get(sessionId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  listBySession(sessionId: string): GoalRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM goal_records WHERE session_id = ? ORDER BY created_at DESC`)
      .all(sessionId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRow(r));
  }

  list(opts?: { status?: GoalStatusValue; limit?: number }): GoalRecord[] {
    const limit = opts?.limit ?? 50;
    const rows = (
      opts?.status
        ? this.db
            .prepare(
              `SELECT * FROM goal_records WHERE status = ? ORDER BY updated_at DESC LIMIT ?`
            )
            .all(opts.status, limit)
        : this.db.prepare(`SELECT * FROM goal_records ORDER BY updated_at DESC LIMIT ?`).all(limit)
    ) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRow(r));
  }

  commitTransition(
    record: GoalRecord,
    event: GoalTransitionEvent,
    patch?: Partial<Pick<GoalRecord, 'turnsUsed' | 'ledger' | 'missing' | 'criteriaStatus' | 'maxTurns'>>
  ): GoalRecord {
    const to = transitionGoal(record.status, event);
    const next: GoalRecord = {
      ...record,
      ...patch,
      status: to,
      closeReason: closeReasonForEvent(event),
      updatedAt: nowIso()
    };
    if (to !== 'unmet_closed') {
      delete next.closeReason;
    } else if (!next.closeReason) {
      next.closeReason = closeReasonForEvent(event);
    }
    this.upsert(next);
    return next;
  }

  private mapRow(row: Record<string, unknown>): GoalRecord {
    const spec = parseJson<GoalSpec>(String(row.spec_json ?? '{}')) ?? {
      goal: '',
      criteria: [],
      source: 'explicit' as const
    };
    const rec: GoalRecord = {
      version: 1,
      goalId: String(row.goal_id),
      sessionId: String(row.session_id),
      status: String(row.status) as GoalStatusValue,
      closeReason: row.close_reason ? (String(row.close_reason) as GoalCloseReason) : undefined,
      spec,
      condition: String(row.condition ?? ''),
      turnsUsed: Number(row.turns_used ?? 0),
      maxTurns: Number(row.max_turns ?? 25),
      missing: row.missing_json ? parseJson<string[]>(String(row.missing_json)) : undefined,
      criteriaStatus: row.criteria_status_json
        ? parseJson<boolean[]>(String(row.criteria_status_json))
        : undefined,
      ledger: parseJson<GoalLedgerEntry[]>(String(row.ledger_json ?? '[]')) ?? [],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
    return upgradeGoalRecord(rec) ?? rec;
  }
}

export function tryGoalStore(store: unknown): GoalStore | null {
  if (!store || typeof store !== 'object') return null;
  const obj = store as { goal?: () => GoalStore; db?: DatabaseSync };
  try {
    if (typeof obj.goal === 'function') return obj.goal();
    if (obj.db) return new GoalStore(obj.db);
  } catch {
    return null;
  }
  return null;
}
