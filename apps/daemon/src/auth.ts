import type { IncomingMessage, ServerResponse } from 'node:http';

const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/readiness',
  '/api/version'
]);

export function checkAuth(request: IncomingMessage, response: ServerResponse, env: NodeJS.ProcessEnv): boolean {
  const token = String(env.RAW_AGENT_AUTH_TOKEN ?? '').trim();
  if (!token) return true;

  const url = new URL(request.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return true;
  if (PUBLIC_PATHS.has(url.pathname)) return true;

  const header = String(request.headers.authorization ?? '');
  const expected = `Bearer ${token}`;
  if (header === expected) return true;

  response.statusCode = 401;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify({ error: 'Unauthorized' }));
  return false;
}
