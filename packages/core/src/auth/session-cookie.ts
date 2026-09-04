import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { AUTH_OAUTH_STATE_COOKIE, AUTH_SESSION_COOKIE } from './types.js';

const SESSION_TTL_SEC = 60 * 60 * 24 * 30;

export function randomUrlToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export function readCookie(headers: IncomingHttpHeaders, name: string): string | undefined {
  const raw = headers.cookie;
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const value = parseCookieHeader(raw)[name];
  return value?.trim() ? value.trim() : undefined;
}

export function readSessionToken(headers: IncomingHttpHeaders): string | undefined {
  return readCookie(headers, AUTH_SESSION_COOKIE);
}

export function serializeCookie(
  name: string,
  value: string,
  opts: { maxAgeSec: number; secure: boolean; httpOnly?: boolean; sameSite?: 'Lax' | 'Strict' | 'None' }
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${Math.max(0, Math.floor(opts.maxAgeSec))}`,
    `SameSite=${opts.sameSite ?? 'Lax'}`
  ];
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

export function sessionCookieHeader(token: string, secure: boolean): string {
  return serializeCookie(AUTH_SESSION_COOKIE, token, {
    maxAgeSec: SESSION_TTL_SEC,
    secure,
    httpOnly: true,
    sameSite: 'Lax'
  });
}

export function clearSessionCookieHeader(secure: boolean): string {
  return serializeCookie(AUTH_SESSION_COOKIE, '', { maxAgeSec: 0, secure, httpOnly: true, sameSite: 'Lax' });
}

export function oauthStateCookieHeader(state: string, secure: boolean): string {
  return serializeCookie(AUTH_OAUTH_STATE_COOKIE, state, {
    maxAgeSec: 600,
    secure,
    httpOnly: true,
    sameSite: 'Lax'
  });
}

export function clearOAuthStateCookieHeader(secure: boolean): string {
  return serializeCookie(AUTH_OAUTH_STATE_COOKIE, '', { maxAgeSec: 0, secure, httpOnly: true, sameSite: 'Lax' });
}

export function sessionTtlMs(): number {
  return SESSION_TTL_SEC * 1000;
}

export { AUTH_OAUTH_STATE_COOKIE, AUTH_SESSION_COOKIE };
