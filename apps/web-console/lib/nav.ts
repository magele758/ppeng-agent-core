export const SECTION_IDS = ['chat', 'agents', 'tasks', 'knowledge', 'ops', 'settings'] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export const SUB_PAGES = {
  chat: [],
  agents: ['agents', 'bots', 'teams', 'skills'],
  tasks: ['queue', 'runs', 'inbox'],
  knowledge: ['memory', 'ingestion'],
  ops: ['trajectory', 'health'],
  settings: ['general', 'models', 'behavior', 'safety', 'tools', 'integrations']
} as const satisfies Record<SectionId, readonly string[]>;

export type SubPageId<S extends SectionId = SectionId> = (typeof SUB_PAGES)[S][number];

export interface NavLocation {
  section: SectionId;
  sub: string | null;
}

export const DEFAULT_LOCATION: NavLocation = { section: 'chat', sub: null };

export function isSectionId(value: string): value is SectionId {
  return (SECTION_IDS as readonly string[]).includes(value);
}

export function subPagesOf(section: SectionId): readonly string[] {
  return SUB_PAGES[section];
}

export function defaultSubOf(section: SectionId): string | null {
  return SUB_PAGES[section][0] ?? null;
}

/** `#/ops/health` → `{section:'ops', sub:'health'}`；非法值回落默认；缺省子页取该 section 第一个子页 */
export function parseHash(hash: string): NavLocation {
  const raw = hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  const [sectionRaw = '', subRaw = ''] = raw.split('/');
  if (!isSectionId(sectionRaw)) return DEFAULT_LOCATION;
  const subs = subPagesOf(sectionRaw);
  if (subs.length === 0) return { section: sectionRaw, sub: null };
  const sub = subs.includes(subRaw) ? subRaw : defaultSubOf(sectionRaw);
  return { section: sectionRaw, sub };
}

export function formatHash(loc: NavLocation): string {
  const subs = subPagesOf(loc.section);
  if (subs.length === 0 || !loc.sub || !subs.includes(loc.sub)) return `#/${loc.section}`;
  return `#/${loc.section}/${loc.sub}`;
}

export function sameLocation(a: NavLocation, b: NavLocation): boolean {
  return a.section === b.section && a.sub === b.sub;
}
