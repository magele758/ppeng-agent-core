/** Shared helpers for Next → daemon `/api/*` proxy (middleware). */

export const LAB_PROXY_HEADER = 'x-ppeng-lab';

const HOP_BY_HOP = [
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
] as const;

export function sanitizeProxyHeaders(src: Headers): Headers {
  const headers = new Headers(src);
  for (const name of HOP_BY_HOP) headers.delete(name);
  return headers;
}

/** Copy daemon response headers, preserving multiple Set-Cookie values. */
export function copyProxyResponseHeaders(res: Headers): Headers {
  const headers = sanitizeProxyHeaders(res);
  const getSetCookie = (res as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === 'function') {
    headers.delete('set-cookie');
    for (const cookie of getSetCookie.call(res)) {
      headers.append('set-cookie', cookie);
    }
  }
  return headers;
}

export function daemonProxyErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const cause =
    err instanceof Error && err.cause instanceof Error
      ? err.cause.message
      : err instanceof Error && err.cause
        ? String(err.cause)
        : '';
  return cause ? `${message} (${cause})` : message;
}
