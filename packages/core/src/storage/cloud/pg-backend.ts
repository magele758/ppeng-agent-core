import type { Pool, PoolConfig } from 'pg';

export type PgPoolHolder = {
  pool: Pool;
  /** Idempotent shutdown for tests / graceful exit. */
  end(): Promise<void>;
};

/**
 * Small helper around `pg.Pool` with lazy import so installs without native build
 * still compile if tree-shaken (optional: not used in pure local mode).
 */
export async function createPgPool(config: PoolConfig | string): Promise<PgPoolHolder> {
  const pg = await import('pg');
  const pool =
    typeof config === 'string'
      ? new pg.default.Pool({ connectionString: config })
      : new pg.default.Pool(config);
  return {
    pool,
    end: () => pool.end(),
  };
}
