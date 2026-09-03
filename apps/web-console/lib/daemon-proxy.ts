/** Shared helpers for Next → daemon `/api/*` proxy (middleware). */

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
