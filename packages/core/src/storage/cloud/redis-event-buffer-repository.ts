import type { Pool } from 'pg';
import { createClient } from 'redis';
import type {
  EventBufferAppendInput,
  EventBufferEventRow,
  EventBufferMeta,
  EventBufferRepository,
} from '../interfaces.js';

function metaCacheKey(tenantId: string, userId: string, sessionId: string): string {
  return `ppeng:eb:meta:${tenantId}:${userId}:${sessionId}`;
}

function rowToMeta(r: {
  tenant_id: string;
  user_id: string;
  session_id: string;
  status: string | null;
  task_content: string | null;
  sequence: number;
  agent_id: string | null;
  saved_at: string | number;
}): EventBufferMeta {
  return {
    tenantId: r.tenant_id,
    userId: r.user_id,
    sessionId: r.session_id,
    status: r.status,
    taskContent: r.task_content,
    sequence: Number(r.sequence),
    agentId: r.agent_id,
    savedAt: typeof r.saved_at === 'string' ? Number(r.saved_at) : Number(r.saved_at),
  };
}

/**
 * PostgreSQL transactional append with `pg_advisory_xact_lock` per (tenant:user, session).
 * Optional Redis: cache meta JSON with TTL after successful commit (best-effort).
 */
export class RedisEventBufferRepository implements EventBufferRepository {
  private redis: ReturnType<typeof createClient> | undefined;
  private redisConnect: Promise<void> | undefined;

  constructor(
    private readonly pool: Pool,
    redisUrl: string | undefined,
    private readonly metaTtlSeconds: number
  ) {
    if (redisUrl?.trim()) {
      this.redis = createClient({ url: redisUrl.trim() });
    }
  }

  private async ensureRedis(): Promise<void> {
    if (!this.redis) return;
    if (!this.redisConnect) {
      this.redisConnect = this.redis.connect().then(
        () => undefined,
        (err: unknown) => {
          this.redisConnect = undefined;
          throw err;
        }
      );
    }
    await this.redisConnect;
  }

  async appendEvent(input: EventBufferAppendInput): Promise<void> {
    const { tenantId, userId, sessionId, eventType, payload, metaPatch } = input;
    const client = await this.pool.connect();
    let nextSeq = 0;
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))`,
        [`${tenantId}:${userId}`, sessionId]
      );
      const maxRes = await client.query(
        `SELECT COALESCE(MAX(seq), -1) AS max_seq FROM ppeng_event_buffer_events
         WHERE tenant_id = $1 AND user_id = $2 AND session_id = $3 FOR UPDATE`,
        [tenantId, userId, sessionId]
      );
      nextSeq = Number(maxRes.rows[0]?.max_seq ?? -1) + 1;
      await client.query(
        `INSERT INTO ppeng_event_buffer_events (tenant_id, user_id, session_id, seq, event_type, payload)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [tenantId, userId, sessionId, nextSeq, eventType, JSON.stringify(payload ?? {})]
      );

      const savedAt = Date.now();
      await client.query(
        `INSERT INTO ppeng_event_buffer_meta
           (tenant_id, user_id, session_id, status, task_content, sequence, agent_id, saved_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (tenant_id, user_id, session_id) DO UPDATE SET
           sequence = EXCLUDED.sequence,
           saved_at = EXCLUDED.saved_at,
           status = COALESCE(EXCLUDED.status, ppeng_event_buffer_meta.status),
           task_content = COALESCE(EXCLUDED.task_content, ppeng_event_buffer_meta.task_content),
           agent_id = COALESCE(EXCLUDED.agent_id, ppeng_event_buffer_meta.agent_id)`,
        [
          tenantId,
          userId,
          sessionId,
          metaPatch?.status ?? null,
          metaPatch?.taskContent ?? null,
          nextSeq,
          metaPatch?.agentId ?? null,
          savedAt,
        ]
      );
      await client.query('COMMIT');
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      client.release();
    }

    if (this.redis) {
      try {
        await this.ensureRedis();
        const meta: EventBufferMeta = {
          tenantId,
          userId,
          sessionId,
          sequence: nextSeq,
          status: metaPatch?.status ?? null,
          taskContent: metaPatch?.taskContent ?? null,
          agentId: metaPatch?.agentId ?? null,
          savedAt: Date.now(),
        };
        await this.redis.set(metaCacheKey(tenantId, userId, sessionId), JSON.stringify(meta), {
          EX: this.metaTtlSeconds,
        });
      } catch {
        /* cache miss acceptable */
      }
    }
  }

  async listEvents(params: {
    tenantId: string;
    userId: string;
    sessionId: string;
  }): Promise<EventBufferEventRow[]> {
    const res = await this.pool.query(
      `SELECT tenant_id, user_id, session_id, seq, event_type, payload
       FROM ppeng_event_buffer_events
       WHERE tenant_id = $1 AND user_id = $2 AND session_id = $3
       ORDER BY seq ASC`,
      [params.tenantId, params.userId, params.sessionId]
    );
    return (res.rows as Array<{
      tenant_id: string;
      user_id: string;
      session_id: string;
      seq: number;
      event_type: string;
      payload: unknown;
    }>).map((r) => ({
      tenantId: r.tenant_id,
      userId: r.user_id,
      sessionId: r.session_id,
      seq: Number(r.seq),
      eventType: r.event_type,
      payload: r.payload,
    }));
  }

  async getMeta(params: {
    tenantId: string;
    userId: string;
    sessionId: string;
  }): Promise<EventBufferMeta | null> {
    if (this.redis) {
      try {
        await this.ensureRedis();
        const raw = await this.redis.get(metaCacheKey(params.tenantId, params.userId, params.sessionId));
        if (raw) {
          const parsed = JSON.parse(raw) as EventBufferMeta;
          if (parsed && parsed.sessionId === params.sessionId) {
            return parsed;
          }
        }
      } catch {
        /* fall through */
      }
    }

    const res = await this.pool.query(
      `SELECT tenant_id, user_id, session_id, status, task_content, sequence, agent_id, saved_at
       FROM ppeng_event_buffer_meta
       WHERE tenant_id = $1 AND user_id = $2 AND session_id = $3`,
      [params.tenantId, params.userId, params.sessionId]
    );
    if (res.rows.length === 0) return null;
    return rowToMeta(res.rows[0]);
  }
}
