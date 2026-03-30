/** 浏览器侧：相对路径 `/api` 由 Next rewrites 代理到 daemon */

export async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(path, init);
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = { _raw: text };
  }
  if (!res.ok) {
    throw new Error((data.error as string) ?? `HTTP ${res.status}`);
  }
  return data;
}
