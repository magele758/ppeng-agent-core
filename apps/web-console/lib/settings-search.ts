export interface SearchableSettingsEntry {
  id: string;
  /** 已翻译的标题 + 关键词，全部拼接 */
  haystack: string;
  /** 已翻译的标题；传入后标题命中的条目排在仅关键词命中的前面 */
  title?: string;
  advanced?: boolean;
}

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFKC').trim();
}

/** 空白分词，所有 token 都必须出现（AND），大小写/全半角不敏感 */
export function matchesQuery(haystack: string, query: string): boolean {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const h = normalize(haystack);
  return tokens.every((tok) => h.includes(tok));
}

/**
 * 可见条目：有搜索词时按搜索过滤并忽略 advanced（命中的高级项自动展示）；
 * 无搜索词时仅在 showAdvanced 为真时包含高级项。
 */
export function filterSettingsEntries<T extends SearchableSettingsEntry>(
  entries: readonly T[],
  query: string,
  showAdvanced: boolean
): T[] {
  const q = query.trim();
  if (q) {
    const hits = entries.filter((e) => matchesQuery(e.haystack, q));
    const tokens = normalize(q).split(/\s+/).filter(Boolean);
    const rank = (e: T) =>
      e.title && tokens.every((tok) => normalize(e.title ?? '').includes(tok)) ? 0 : 1;
    return hits
      .map((e, i) => ({ e, i, r: rank(e) }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.e);
  }
  return entries.filter((e) => showAdvanced || !e.advanced);
}
