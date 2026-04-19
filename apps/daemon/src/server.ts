import 'dotenv/config';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { cwd, env } from 'node:process';
import {
  createGatewayContext,
  handleGatewayHttp,
  startGatewayLearnTicker
} from '@ppeng/agent-capability-gateway';
import {
  RawAgentRuntime,
  PayloadTooLargeError,
  errorMessage,
  httpStatusFromError,
  createLogger
} from '@ppeng/agent-core';
import { handleEvolutionApi } from './evolution-api.js';
import { json } from './http-utils.js';
import {
  clientKeyFromRequest,
  createRateLimiter,
  rateLimitConfigFromEnv,
  rejectRateLimited
} from './rate-limit.js';
import { Router } from './routing.js';
import { sessionsRoutes } from './routes/sessions.js';
import { tasksRoutes } from './routes/tasks.js';
import { socialRoutes } from './routes/social.js';
import { selfHealRoutes } from './routes/self-heal.js';
import { mailboxRoutes } from './routes/mailbox.js';
import { miscRoutes } from './routes/misc.js';

/** Playwright/regression: 加载 .env 后强制本地 heuristic adapter，避免误触远程兼容适配器。 */
if (['1', 'true', 'yes'].includes(String(env.RAW_AGENT_E2E_ISOLATE ?? '').toLowerCase())) {
  env.RAW_AGENT_MODEL_PROVIDER = 'heuristic';
  for (const k of [
    'RAW_AGENT_BASE_URL',
    'RAW_AGENT_API_KEY',
    'RAW_AGENT_MODEL_NAME',
    'RAW_AGENT_VL_MODEL_NAME',
    'RAW_AGENT_VL_BASE_URL',
    'RAW_AGENT_VL_API_KEY'
  ]) {
    delete env[k];
  }
}

const repoRoot = cwd();
const stateDir = env.RAW_AGENT_STATE_DIR ?? join(repoRoot, '.agent-state');
const host = env.RAW_AGENT_DAEMON_HOST ?? '127.0.0.1';
const port = Number(env.RAW_AGENT_DAEMON_PORT ?? 7070);
const readBodyLimit = Number(env.RAW_AGENT_MAX_BODY_BYTES ?? 2_000_000);
const corsOrigins = (env.RAW_AGENT_CORS_ORIGIN ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const log = createLogger('daemon');

const runtime = new RawAgentRuntime({ repoRoot, stateDir });

let gatewayCtx = await createGatewayContext(runtime, repoRoot, stateDir);
if (gatewayCtx) {
  log.info(`capability-gateway enabled at ${gatewayCtx.env.pathPrefix}`);
  startGatewayLearnTicker(() => gatewayCtx, (e) => log.error('gateway learn tick failed', e)).unref();
}

let pkgVersion = '0.0.0';
let pkgName = 'my-raw-agent-sdk';
try {
  const raw = readFileSync(join(repoRoot, 'package.json'), 'utf8');
  const pkg = JSON.parse(raw) as { name?: string; version?: string };
  if (pkg.version) pkgVersion = pkg.version;
  if (pkg.name) pkgName = pkg.name;
} catch {
  /* keep defaults */
}

function applyCors(request: IncomingMessage, response: ServerResponse<IncomingMessage>): boolean {
  if (corsOrigins.length === 0) return true;
  const origin = request.headers.origin;
  const allow =
    corsOrigins.includes('*') || (typeof origin === 'string' && corsOrigins.includes(origin));
  if (allow && origin) {
    response.setHeader('access-control-allow-origin', corsOrigins.includes('*') ? '*' : origin);
    response.setHeader('vary', 'Origin');
  }
  if (allow) {
    response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    response.setHeader('access-control-allow-headers', 'content-type, authorization');
  }
  return allow;
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  const limit = Number.isFinite(readBodyLimit) && readBodyLimit > 0 ? readBodyLimit : 2_000_000;
  for await (const chunk of request) {
    const buf = Buffer.from(chunk);
    total += buf.length;
    if (total > limit) throw new PayloadTooLargeError(limit);
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SyntaxError('Invalid JSON body');
  }
}

const router = new Router({ applyCors, readBody })
  .addAll(miscRoutes(runtime, { pkgName, pkgVersion }))
  .addAll(sessionsRoutes(runtime))
  .addAll(tasksRoutes(runtime))
  .addAll(socialRoutes(runtime, repoRoot))
  .addAll(selfHealRoutes(runtime))
  .addAll(mailboxRoutes(runtime));

// E3: rate-limit endpoints that drive the model adapter (real $$ on remote
// providers). Heuristic adapter is also rate-limited but it's basically free.
const limiterConfig = rateLimitConfigFromEnv(env);
const limiter = createRateLimiter(limiterConfig);
const limiterSweep = setInterval(() => limiter.sweep(), 60_000);
limiterSweep.unref();

function isExpensiveEndpoint(method: string, pathname: string): boolean {
  if (method !== 'POST') return false;
  // Direct model-spending endpoints
  if (pathname === '/api/chat' || pathname === '/api/chat/stream') return true;
  if (pathname === '/api/scheduler/run') return true;
  if (pathname === '/api/teams') return true;
  if (pathname === '/api/tasks') return true;
  // /api/sessions (create with autoRun)
  if (pathname === '/api/sessions') return true;
  // /api/sessions/:id/(run|stream|messages)
  if (/^\/api\/sessions\/[^/]+\/(run|stream|messages)$/.test(pathname)) return true;
  // /api/sessions/:id/images/fetch-url (also SSRF surface)
  if (/^\/api\/sessions\/[^/]+\/images\/fetch-url$/.test(pathname)) return true;
  // /api/approvals/:id/:decision (approve triggers runSession)
  if (/^\/api\/approvals\/[^/]+\/(approve|reject)$/.test(pathname)) return true;
  return false;
}

/**
 * Defensive headers applied to every response (static + API + SSE).
 *  - X-Content-Type-Options: stop browsers MIME-sniffing JSON as HTML.
 *  - Referrer-Policy: don't leak agent URLs to upstream RSS / image CDNs.
 *  - X-Frame-Options: prevent click-jacking the dev console.
 *  - CSP: deny all by default for the stub HTML; the Next.js console runs
 *    through its own middleware where richer CSP belongs.
 */
function applySecurityHeaders(response: ServerResponse<IncomingMessage>, isHtml: boolean): void {
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-frame-options', 'DENY');
  if (isHtml) {
    response.setHeader(
      'content-security-policy',
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'"
    );
  }
}

async function serveStatic(pathname: string, response: ServerResponse<IncomingMessage>) {
  const webRoot = resolve(repoRoot, 'apps/daemon/web-stub');
  const relative = pathname === '/' || pathname === '' ? 'index.html' : pathname.replace(/^\//, '');
  if (relative.includes('..') || relative.startsWith('/')) {
    response.statusCode = 404;
    response.end('Not found');
    return;
  }
  const sourcePath = normalize(join(webRoot, relative));
  // Reject paths that share only a prefix (e.g. webRoot="/a" vs sourcePath="/ab/c")
  // by requiring an explicit separator boundary or exact match.
  if (sourcePath !== webRoot && !sourcePath.startsWith(webRoot + sep)) {
    response.statusCode = 404;
    response.end('Not found');
    return;
  }

  const typeMap: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8'
  };

  try {
    const content = await readFile(sourcePath);
    response.statusCode = 200;
    const ct = typeMap[extname(sourcePath)] ?? 'text/plain; charset=utf-8';
    response.setHeader('content-type', ct);
    applySecurityHeaders(response, ct.startsWith('text/html'));
    response.end(content);
  } catch {
    response.statusCode = 404;
    response.end('Not found');
  }
}

async function handleApi(request: IncomingMessage, response: ServerResponse<IncomingMessage>) {
  const url = new URL(request.url ?? '/', `http://${host}:${port}`);

  // Capability-gateway sits in front of /api/* so it can claim its own prefix
  // (e.g. /gateway/v1) before our table runs.
  if (gatewayCtx) {
    const handled = await handleGatewayHttp(request, response, gatewayCtx, readBodyLimit);
    if (handled) return;
  }

  // Evolution monitoring API has its own router.
  if (handleEvolutionApi(request, response, repoRoot)) return;

  // Rate-limit only model-spending endpoints; cheap GETs and sweep ticks
  // remain unrestricted.
  if (isExpensiveEndpoint(request.method ?? '', url.pathname)) {
    const decision = limiter.take(clientKeyFromRequest(request, limiterConfig.trustProxy));
    if (!decision.ok) {
      rejectRateLimited(response, decision.retryAfterMs);
      return;
    }
  }

  const matched = await router.dispatch(request, response, url);
  if (!matched) {
    json(response, 404, { error: 'Route not found' });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${host}:${port}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      // API responses are JSON or SSE — apply non-HTML security headers up-front
      // so even error paths get them.
      applySecurityHeaders(response, false);
      await handleApi(request, response);
      return;
    }
    await serveStatic(url.pathname, response);
  } catch (error) {
    const status = httpStatusFromError(error);
    json(response, status, { error: errorMessage(error) });
  }
});

function maybeAutoStartSelfHeal(): void {
  const v = String(env.RAW_AGENT_SELF_HEAL_AUTO_START ?? '').trim().toLowerCase();
  if (!['1', 'true', 'yes'].includes(v)) return;
  try {
    const run = runtime.startSelfHealRun();
    log.info(`self-heal auto-start: run ${run.id} (policy from RAW_AGENT_SELF_HEAL_* env)`);
  } catch (e) {
    const msg = errorMessage(e);
    if (msg.includes('Another self-heal')) {
      log.info('self-heal auto-start skipped: another run already active');
    } else {
      log.error('self-heal auto-start failed:', msg);
    }
  }
}

server.listen(port, host, () => {
  log.info(`listening on http://${host}:${port}`);
  maybeAutoStartSelfHeal();
});

const schedulerTimer = setInterval(async () => {
  try {
    await runtime.runScheduler();
  } catch (error) {
    log.error('scheduler loop failed', error);
  }
}, 1_500);
schedulerTimer.unref();

/**
 * Graceful shutdown:
 *   - stop the scheduler tick so SQLite isn't accessed during teardown,
 *   - close the HTTP server so in-flight requests finish (with a hard 5s cap),
 *   - call runtime.destroy() to abort sandbox jobs + tear down MCP stdio,
 *   - then exit. Repeated signals force-exit to recover from a stuck close.
 */
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    log.warn(`received ${signal} during shutdown — forcing exit`);
    process.exit(1);
  }
  shuttingDown = true;
  log.info(`received ${signal}, starting graceful shutdown`);
  clearInterval(schedulerTimer);
  clearInterval(limiterSweep);

  // Give in-flight requests 5s to finish; after that, force-close every socket
  // (SSE streams would otherwise keep the server open indefinitely).
  await new Promise<void>((resolve) => {
    const deadline = setTimeout(() => {
      log.warn('shutdown: server.close timeout (5s), forcing closeAllConnections');
      // Node ≥18.2 — terminates every tracked socket immediately.
      if (typeof (server as any).closeAllConnections === 'function') {
        (server as any).closeAllConnections();
      }
      resolve();
    }, 5_000);
    server.close(() => {
      clearTimeout(deadline);
      resolve();
    });
  });

  try {
    await runtime.destroy();
  } catch (e) {
    log.error('runtime.destroy failed', e);
  }
  log.info('shutdown complete');
  process.exit(0);
}

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => { void shutdown(sig); });
}
