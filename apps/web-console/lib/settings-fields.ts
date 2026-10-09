export type IntParseResult = { ok: true; value: number } | { ok: false };

/** 整数范围校验；空串、小数、越界、非数字均视为非法 */
export function parseIntInRange(raw: string, min: number, max: number): IntParseResult {
  const text = raw.trim();
  if (text === '' || !/^-?\d+$/.test(text)) return { ok: false };
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < min || value > max) return { ok: false };
  return { ok: true, value };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  return Object.is(a, b);
}

/** 当前值是否等于系统默认值（决定是否显示「恢复默认」） */
export function isDefaultValue(value: unknown, defaultValue: unknown): boolean {
  return sameValue(value, defaultValue);
}

/** 表单草稿相对已保存值改了哪些字段 */
export function changedKeys<T extends object>(draft: T, saved: T, keys: readonly (keyof T)[]): (keyof T)[] {
  return keys.filter((k) => !sameValue(draft[k], saved[k]));
}

export function isDirty<T extends object>(draft: T, saved: T, keys: readonly (keyof T)[]): boolean {
  return changedKeys(draft, saved, keys).length > 0;
}

/** 只取被修改的字段，作为 PATCH body */
export function buildPatch<T extends object>(
  draft: T,
  saved: T,
  keys: readonly (keyof T)[]
): Partial<Pick<T, keyof T>> {
  const patch: Partial<T> = {};
  for (const k of changedKeys(draft, saved, keys)) patch[k] = draft[k];
  return patch;
}

/** 逗号 / 换行分隔的列表输入 → 去空去重数组 */
export function parseListInput(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[,\n]/)) {
    const s = part.trim();
    if (s) seen.add(s);
  }
  return [...seen];
}

export function formatListInput(items: readonly string[] | undefined): string {
  return (items ?? []).join(', ');
}
