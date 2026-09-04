import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  AuthStore,
  authUserFromId,
  hashToken,
  LAB_PROXY_HEADER,
  oauthPublicConfig,
  oauthPublicOrigin,
  readSessionToken,
  type AgentMemoryStore,
  type RequestAuth
} from '@ppeng/agent-core';
import { json } from './http-utils.js';

const PUBLIC_PATHS = new Set(['/api/health', '/api/readiness', '/api/version']);

export function isLabProxyRequest(request: IncomingMessage): boolean {
  const header = request.headers[LAB_PROXY_HEADER];
  const raw = Array.isArray(header) ? header[0] : header;
  return String(raw ?? '').trim() === '1';
}

export function isAuthPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return pathname === '/api/auth' || pathname.startsWith('/api/auth/');
}

export function requestPublicOrigin(request: IncomingMessage, env: NodeJS.ProcessEnv): string {
  const forwardedHost = headerValue(request, 'x-forwarded-host');
  const forwardedProto = headerValue(request, 'x-forwarded-proto');
  const host = forwardedHost || headerValue(request, 'host') || '';
  const proto = forwardedProto || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  const fallback = host.includes('://') ? host : host ? `${proto}://${host}` : '';
  return oauthPublicOrigin(env, fallback);
}

export function requestSecure(request: IncomingMessage, env: NodeJS.ProcessEnv): boolean {
  return requestPublicOrigin(request, env).startsWith('https://');
}

export function resolveRequestAuth(params: {
  request: IncomingMessage;
  env: NodeJS.ProcessEnv;
  memory: AgentMemoryStore;
  authStore: AuthStore;
}): RequestAuth {
  const labProxy = isLabProxyRequest(params.request);
  const loginRequired = oauthPublicConfig(params.env).loginRequired;
  const token = readSessionToken(params.request.headers);
  let user = null;
  if (token) {
    const row = params.authStore.getAuthSession(hashToken(token));
    if (row) user = authUserFromId(params.memory, row.userId, params.env);
  }
  return {
    labProxy,
    isolate: Boolean(labProxy && loginRequired && user),
    user
  };
}

export function requireLabLogin(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  env: NodeJS.ProcessEnv,
  auth: RequestAuth
): boolean {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (isAuthPublicPath(url.pathname)) return true;
  const cfg = oauthPublicConfig(env);
  if (!cfg.loginRequired) return true;
  if (!auth.labProxy) return true;
  if (auth.user) return true;
  json(response, 401, {
    error: 'login_required',
    loginRequired: true,
    providers: cfg.providers
  });
  return false;
}

export function headerValue(request: IncomingMessage, name: string): string {
  const raw = request.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return String(value ?? '').trim();
}
