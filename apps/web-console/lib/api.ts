/** 浏览器侧：相对路径 `/api` 由 Next rewrites 代理到 daemon */

/**
 * Per-process ETag cache for GET requests. The daemon emits `ETag: W/"<n>"`
 * on poll-friendly list endpoints (sessions, tasks, approvals, social-post-
 * schedules, mailbox/all). When the server responds 304 we reuse the cached
 * payload instead of triggering a re-render.
 *
 * Cache is best-effort and process-local (cleared on full reload).
 */
const etagCache = new Map<string, { etag: string; data: unknown }>();

function isCacheableGet(path: string, init?: RequestInit): boolean {
  if (init?.method && init.method.toUpperCase() !== 'GET') return false;
  return path.startsWith('/api/');
}

export async function api(path: string, init?: RequestInit): Promise<unknown> {
  const cacheable = isCacheableGet(path, init);
  const cached = cacheable ? etagCache.get(path) : undefined;
  const headers = new Headers(init?.headers ?? {});
  if (cached) headers.set('if-none-match', cached.etag);

  const res = await fetch(path, { ...init, headers });

  // 304 → reuse cached body without parsing or re-rendering caller.
  if (res.status === 304 && cached) {
    return cached.data;
  }

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

  if (cacheable) {
    const etag = res.headers.get('etag');
    if (etag) etagCache.set(path, { etag, data });
  }
  return data;
}
