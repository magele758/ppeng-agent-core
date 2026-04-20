/** Sort agents with 'general' pinned first, rest alphabetical. */
export function sortAgentsById<T extends { id: string }>(aList: T[]): T[] {
  return [...aList].sort((a, b) => {
    if (a.id === 'general') return -1;
    if (b.id === 'general') return 1;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Group agents by their `domainId` for the agent selector. Agents without a
 * domainId fall into the "core" bucket. Within each group the order from
 * `sortAgentsById` is preserved. The "core" group is rendered first so the
 * default `general` persona stays prominent; remaining groups are listed
 * alphabetically by domainId.
 */
export function groupAgentsByDomain<T extends { id: string; domainId?: string }>(
  aList: T[]
): Array<{ domainId: string; agents: T[] }> {
  const sorted = sortAgentsById(aList);
  const buckets = new Map<string, T[]>();
  for (const a of sorted) {
    const key = a.domainId ?? 'core';
    const arr = buckets.get(key) ?? [];
    arr.push(a);
    buckets.set(key, arr);
  }
  const ordered = [...buckets.entries()].sort(([a], [b]) => {
    if (a === 'core') return -1;
    if (b === 'core') return 1;
    return a.localeCompare(b);
  });
  return ordered.map(([domainId, agents]) => ({ domainId, agents }));
}
