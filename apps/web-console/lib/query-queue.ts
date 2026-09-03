export type SteerInterruptPolicy = 'queue' | 'steer' | 'disabled';

/** How a queued follow-up should run once consumed. */
export type QueryExecMode = 'steering' | 'subagent';

export type SteerInboxItem = {
  id: string;
  text: string;
  target?: string;
  createdAt?: string;
  mode?: QueryExecMode;
};

export function parseQueryExecMode(raw: unknown): QueryExecMode | undefined {
  if (raw === 'steering' || raw === 'steer' || raw === 'prompt') return 'steering';
  if (raw === 'subagent') return 'subagent';
  return undefined;
}

export function queryExecModeOf(item: Pick<SteerInboxItem, 'mode'> | unknown): QueryExecMode {
  if (!item || typeof item !== 'object') return 'steering';
  return parseQueryExecMode((item as SteerInboxItem).mode) ?? 'steering';
}

/** Body fragment for POST /steer. Steering is the default (omit mode). */
export function steerBodyFromQueryMode(mode: QueryExecMode): { mode?: 'subagent' } {
  return mode === 'subagent' ? { mode: 'subagent' } : {};
}

export function mapSteerInboxItems(raw: unknown): SteerInboxItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string')
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        id: String(row.id),
        text: String(row.text ?? ''),
        target: typeof row.target === 'string' ? row.target : undefined,
        createdAt: typeof row.createdAt === 'string' ? row.createdAt : undefined,
        mode: parseQueryExecMode(row.mode ?? row.steerMode)
      };
    });
}
