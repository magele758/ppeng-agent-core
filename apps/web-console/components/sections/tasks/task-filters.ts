export const TASK_STATUSES = ['pending', 'in_progress', 'completed', 'failed', 'cancelled'] as const;
export const RUN_STATUSES = ['pending', 'running', 'waiting_approval', 'completed', 'failed', 'blocked'] as const;

export type StatusFilter<S extends string> = S | 'all';

export interface FilterState<S extends string> {
  status: StatusFilter<S>;
  query: string;
}

export function countByStatus<T extends { status: string }, S extends string>(
  items: readonly T[],
  statuses: readonly S[]
): Record<StatusFilter<S>, number> {
  const counts = { all: items.length } as Record<StatusFilter<S>, number>;
  for (const s of statuses) counts[s] = 0;
  for (const item of items) {
    if ((statuses as readonly string[]).includes(item.status)) counts[item.status as S] += 1;
  }
  return counts;
}

export function filterByStatusAndQuery<T extends { status: string }, S extends string>(
  items: readonly T[],
  { status, query }: FilterState<S>,
  textOf: (item: T) => ReadonlyArray<string | undefined>
): T[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => {
    if (status !== 'all' && item.status !== status) return false;
    if (!needle) return true;
    return textOf(item).some((part) => part?.toLowerCase().includes(needle));
  });
}
