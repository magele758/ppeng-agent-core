export const MEMORY_SCOPE_IDS = ['session.scratch', 'session.long', 'user.memory', 'team.memory', 'project.memory'] as const;
export type MemoryScopeId = (typeof MEMORY_SCOPE_IDS)[number];

export interface MemoryScopeMeta {
  id: MemoryScopeId;
  /** `memory.scopes.<slug>.label|desc` 的 i18n 键片段 */
  slug: 'sessionScratch' | 'sessionLong' | 'user' | 'team' | 'project';
}

export const MEMORY_SCOPES: readonly MemoryScopeMeta[] = [
  { id: 'session.scratch', slug: 'sessionScratch' },
  { id: 'session.long', slug: 'sessionLong' },
  { id: 'user.memory', slug: 'user' },
  { id: 'team.memory', slug: 'team' },
  { id: 'project.memory', slug: 'project' }
];

export interface MemoryEntryLike {
  key: string;
  value: string;
}

export function scopeNeedsSession(scope: string): boolean {
  return scope.startsWith('session.');
}

export function filterMemoryEntries<T extends MemoryEntryLike>(entries: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...entries];
  return entries.filter((e) => e.key.toLowerCase().includes(needle) || String(e.value).toLowerCase().includes(needle));
}

export function canAddMemory(draft: MemoryEntryLike): boolean {
  return draft.key.trim().length > 0 && draft.value.trim().length > 0;
}
