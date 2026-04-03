/** Sort agents with 'general' pinned first, rest alphabetical. */
export function sortAgentsById<T extends { id: string }>(aList: T[]): T[] {
  return [...aList].sort((a, b) => {
    if (a.id === 'general') return -1;
    if (b.id === 'general') return 1;
    return a.id.localeCompare(b.id);
  });
}
