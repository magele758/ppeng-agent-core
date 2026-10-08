import type { IncomingMessage, ServerResponse } from 'node:http';
import { tokensEqual } from '@ppeng/agent-core';

const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/readiness',
  '/api/version'
]);

function daemonToken(env: NodeJS.ProcessEnv): string {
  return String(env.RAW_AGENT_AUTH_TOKEN ?? '').trim();
}

/** True when `RAW_AGENT_AUTH_TOKEN` is set and the request carries it as a Bearer token. */
export function hasDaemonBearer(request: IncomingMessage, env: NodeJS.ProcessEnv): boolean {
  const token = daemonToken(env);
  if (!token) return false;
  return tokensEqual(String(request.headers.authorization ?? ''), `Bearer ${token}`);
}

export function checkAuth(request: IncomingMessage, response: ServerResponse, env: NodeJS.ProcessEnv): boolean {
  if (!daemonToken(env)) return true;

  const url = new URL(request.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return true;
  if (PUBLIC_PATHS.has(url.pathname)) return true;
  if (hasDaemonBearer(request, env)) return true;

  response.statusCode = 401;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify({ error: 'Unauthorized' }));
  return false;
}
