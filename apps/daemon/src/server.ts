import 'dotenv/config';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { cwd, env } from 'node:process';
import {
  createGatewayContext,
  handleGatewayHttp,
  startGatewayLearnTicker
} from '@ppeng/agent-capability-gateway';
import { RawAgentRuntime, AppError, PayloadTooLargeError, NotFoundError, ValidationError, ConflictError, errorMessage, httpStatusFromError, createLogger } from '@ppeng/agent-core';
import { handleEvolutionApi } from './evolution-api.js';
import { makeSocialPostDeliver } from './social-schedule-deliver.js';

/** Playwright/regression：在加载 .env 后仍强制本地 heuristic，避免误触远程兼容适配器 */
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

const runtime = new RawAgentRuntime({
  repoRoot,
  stateDir
});

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
  if (pkg.version) {
    pkgVersion = pkg.version;
  }
  if (pkg.name) {
    pkgName = pkg.name;
  }
} catch {
  /* keep defaults */
}

function json(response: ServerResponse<IncomingMessage>, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body, null, 2));
}

function applyCors(request: IncomingMessage, response: ServerResponse<IncomingMessage>): boolean {
  if (corsOrigins.length === 0) {
    return true;
  }
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
    if (total > limit) {
      throw new PayloadTooLargeError(limit);
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) {
    return {};
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SyntaxError('Invalid JSON body');
  }
}

function sseInit(response: ServerResponse<IncomingMessage>): void {
  response.statusCode = 200;
  response.setHeader('content-type', 'text/event-stream; charset=utf-8');
  response.setHeader('cache-control', 'no-cache');
  response.setHeader('connection', 'keep-alive');
  response.flushHeaders?.();
}

function sseSend(response: ServerResponse<IncomingMessage>, event: string, data: unknown): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function serveStatic(pathname: string, response: ServerResponse<IncomingMessage>) {
  const webRoot = resolve(repoRoot, 'apps/daemon/web-stub');
  const relative =
    pathname === '/' || pathname === '' ? 'index.html' : pathname.replace(/^\//, '');
  if (relative.includes('..') || relative.startsWith('/')) {
    response.statusCode = 404;
    response.end('Not found');
    return;
  }
  const sourcePath = normalize(join(webRoot, relative));
  if (!sourcePath.startsWith(webRoot)) {
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
    response.setHeader('content-type', typeMap[extname(sourcePath)] ?? 'text/plain; charset=utf-8');
    response.end(content);
  } catch {
    response.statusCode = 404;
    response.end('Not found');
  }
}

function splitPath(pathname: string): string[] {
  return pathname.split('/').filter(Boolean);
}

function imageAssetIdsFromBody(body: Record<string, unknown>): string[] {
  if (!Array.isArray(body.imageAssetIds)) return [];
  return body.imageAssetIds.map(String).filter(Boolean);
}

async function handleApi(request: IncomingMessage, response: ServerResponse<IncomingMessage>) {
  const url = new URL(request.url ?? '/', `http://${host}:${port}`);
  const parts = splitPath(url.pathname);

  if (gatewayCtx) {
    const handled = await handleGatewayHttp(request, response, gatewayCtx, readBodyLimit);
    if (handled) {
      return;
    }
  }

  if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
    if (applyCors(request, response)) {
      response.statusCode = 204;
      response.end();
    } else {
      response.statusCode = 403;
      response.end();
    }
    return;
  }

  applyCors(request, response);

  // Evolution monitoring API
  if (handleEvolutionApi(request, response, repoRoot)) {
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/version') {
    json(response, 200, {
      name: pkgName,
      version: pkgVersion
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    json(response, 200, {
      ok: true,
      adapter: runtime.modelAdapter.name,
      version: pkgVersion
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/sessions') {
    json(response, 200, {
      sessions: runtime.listSessions()
    });
    return;
  }

  if (request.method === 'POST' && parts[0] === 'api' && parts[1] === 'sessions' && parts[3] === 'images') {
    const sessionId = parts[2];
    if (!sessionId) throw new ValidationError('Missing session id');
    if (parts[4] === 'ingest-base64') {
      const body = (await readBody(request)) as Record<string, unknown>;
      try {
        const asset = await runtime.ingestImageBase64(sessionId, {
          dataBase64: String(body.dataBase64 ?? ''),
          mimeType: String(body.mimeType ?? 'image/png'),
          sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : undefined
        });
        json(response, 201, { asset });
      } catch (error) {
        throw error instanceof AppError ? error : new ValidationError(errorMessage(error));
      }
      return;
    }
    if (parts[4] === 'fetch-url') {
      const body = (await readBody(request)) as Record<string, unknown>;
      const imageUrl = String(body.url ?? '').trim();
      if (!imageUrl) throw new ValidationError('Missing url');
      try {
        const asset = await runtime.ingestImageFromUrl(sessionId, imageUrl);
        json(response, 201, { asset });
      } catch (error) {
        throw error instanceof AppError ? error : new ValidationError(errorMessage(error));
      }
      return;
    }
  }

  if (request.method === 'POST' && url.pathname === '/api/chat/stream') {
    const body = (await readBody(request)) as Record<string, unknown>;
    const message = String(body.message ?? '').trim();
    const imgIds = imageAssetIdsFromBody(body);
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
    if (!message && imgIds.length === 0) throw new ValidationError('Missing message or imageAssetIds');

    const session = sessionId
      ? runtime.sendUserMessage(sessionId, message || '(image)', { imageAssetIds: imgIds })
      : runtime.createChatSession({
          title: typeof body.title === 'string' ? body.title : 'Chat Session',
          message: message || undefined,
          imageAssetIds: imgIds.length ? imgIds : undefined,
          agentId: typeof body.agentId === 'string' ? body.agentId : undefined,
          background: false
        });

    sseInit(response);
    try {
      await runtime.runSession(session.id, {
        onModelStreamChunk: (chunk) => {
          sseSend(response, 'model', chunk);
        }
      });
      sseSend(response, 'result', {
        session: runtime.getSession(session.id),
        latestAssistant: runtime.getLatestAssistantText(session.id)
      });
    } catch (error) {
      sseSend(response, 'error', { message: error instanceof Error ? error.message : String(error) });
    }
    response.end();
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/chat') {
    const body = (await readBody(request)) as Record<string, unknown>;
    const message = String(body.message ?? '').trim();
    const imgIds = imageAssetIdsFromBody(body);
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
    if (!message && imgIds.length === 0) throw new ValidationError('Missing message or imageAssetIds');

    const session = sessionId
      ? runtime.sendUserMessage(sessionId, message || '(image)', { imageAssetIds: imgIds })
      : runtime.createChatSession({
          title: typeof body.title === 'string' ? body.title : 'Chat Session',
          message: message || undefined,
          imageAssetIds: imgIds.length ? imgIds : undefined,
          agentId: typeof body.agentId === 'string' ? body.agentId : undefined,
          background: false
        });

    await runtime.runSession(session.id);
    json(response, 200, {
      session: runtime.getSession(session.id),
      latestAssistant: runtime.getLatestAssistantText(session.id),
      messages: runtime.getSessionMessages(session.id)
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/sessions') {
    const body = (await readBody(request)) as Record<string, unknown>;
    const mode = body.mode === 'task' ? 'task' : 'chat';
    if (mode === 'task') {
      const result = runtime.createTaskSession({
        title: String(body.title ?? body.message ?? 'Task Session'),
        description: typeof body.description === 'string' ? body.description : undefined,
        message: typeof body.message === 'string' ? body.message : undefined,
        imageAssetIds: imageAssetIdsFromBody(body),
        agentId: typeof body.agentId === 'string' ? body.agentId : undefined,
        blockedBy: Array.isArray(body.blockedBy) ? body.blockedBy.map(String) : undefined,
        background: body.background !== false
      });
      if (body.autoRun !== false) {
        await runtime.runSession(result.session.id);
      }
      json(response, 201, {
        session: runtime.getSession(result.session.id),
        task: runtime.getTask(result.task.id),
        latestAssistant: runtime.getLatestAssistantText(result.session.id)
      });
      return;
    }

    const session = runtime.createChatSession({
      title: typeof body.title === 'string' ? body.title : 'Chat Session',
      message: typeof body.message === 'string' ? body.message : undefined,
      imageAssetIds: imageAssetIdsFromBody(body),
      agentId: typeof body.agentId === 'string' ? body.agentId : undefined,
      background: body.background === true
    });
    const hasContent =
      (typeof body.message === 'string' && body.message.trim()) || imageAssetIdsFromBody(body).length > 0;
    if (body.autoRun !== false && hasContent) {
      await runtime.runSession(session.id);
    }
    json(response, 201, {
      session: runtime.getSession(session.id),
      latestAssistant: runtime.getLatestAssistantText(session.id)
    });
    return;
  }

  if (request.method === 'POST' && parts[0] === 'api' && parts[1] === 'sessions' && parts[3] === 'messages') {
    const sessionId = parts[2];
    if (!sessionId) throw new ValidationError('Missing session id');
    const body = (await readBody(request)) as Record<string, unknown>;
    const message = String(body.message ?? '').trim();
    const imgIds = imageAssetIdsFromBody(body);
    if (!message && imgIds.length === 0) throw new ValidationError('Missing message or imageAssetIds');
    runtime.sendUserMessage(sessionId, message || '(image)', { imageAssetIds: imgIds });
    if (body.autoRun !== false) {
      await runtime.runSession(sessionId);
    }
    json(response, 200, {
      session: runtime.getSession(sessionId),
      latestAssistant: runtime.getLatestAssistantText(sessionId),
      messages: runtime.getSessionMessages(sessionId)
    });
    return;
  }

  if (request.method === 'GET' && parts[0] === 'api' && parts[1] === 'sessions' && parts[2]) {
    const sessionId = parts[2];
    const session = runtime.getSession(sessionId);
    if (!session) throw new NotFoundError('Session');
    const task = session.taskId ? runtime.getTask(session.taskId) : undefined;
    json(response, 200, {
      session,
      task,
      messages: runtime.getSessionMessages(session.id),
      latestAssistant: runtime.getLatestAssistantText(session.id)
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/tasks') {
    json(response, 200, {
      tasks: runtime.listTasks()
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/social-post-schedules') {
    json(response, 200, {
      items: runtime.listSocialPostScheduleSummaries()
    });
    return;
  }

  if (request.method === 'POST' && url.pathname.startsWith('/api/social-post-schedules/') && url.pathname.endsWith('/action')) {
    const segs = url.pathname.split('/').filter(Boolean);
    const taskId = segs[2];
    if (!taskId) throw new ValidationError('Missing task id');
    const body = (await readBody(request)) as Record<string, unknown>;
    const action = String(body.action ?? '').trim();
    if (action === 'approve' || action === 'reject' || action === 'cancel') {
      const task = runtime.applySocialPostScheduleAction(taskId, action);
      json(response, 200, { task });
      return;
    }
    if (action === 'run_now') {
      const deliver = await makeSocialPostDeliver(repoRoot);
      const task = await runtime.dispatchSocialPostScheduleNow(taskId, deliver);
      json(response, 200, { task });
      return;
    }
    throw new ValidationError('action must be approve, reject, cancel, or run_now');
  }

  if (request.method === 'POST' && url.pathname === '/api/tasks') {
    const body = (await readBody(request)) as Record<string, unknown>;
    const result = runtime.createTaskSession({
      title: String(body.title ?? body.goal ?? 'Task'),
      description: typeof body.description === 'string' ? body.description : undefined,
      message: typeof body.message === 'string' ? body.message : typeof body.goal === 'string' ? body.goal : undefined,
      imageAssetIds: imageAssetIdsFromBody(body),
      agentId: typeof body.agentId === 'string' ? body.agentId : undefined,
      blockedBy: Array.isArray(body.blockedBy) ? body.blockedBy.map(String) : undefined,
      background: body.background !== false
    });
    if (body.autoRun !== false) {
      await runtime.runSession(result.session.id);
    }
    json(response, 201, {
      task: runtime.getTask(result.task.id),
      session: runtime.getSession(result.session.id),
      latestAssistant: runtime.getLatestAssistantText(result.session.id)
    });
    return;
  }

  if (request.method === 'GET' && parts[0] === 'api' && parts[1] === 'tasks' && parts[2]) {
    const taskId = parts[2];
    const task = runtime.getTask(taskId);
    if (!task) throw new NotFoundError('Task');
    json(response, 200, {
      task,
      events: runtime.getTaskEvents(taskId),
      session: task.sessionId ? runtime.getSession(task.sessionId) : undefined
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/scheduler/run') {
    await runtime.runScheduler();
    json(response, 200, { ok: true });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/self-heal/start') {
    const body = (await readBody(request)) as Record<string, unknown>;
    const policy =
      body.policy && typeof body.policy === 'object' && !Array.isArray(body.policy)
        ? (body.policy as Record<string, unknown>)
        : body;
    try {
      const run = runtime.startSelfHealRun(policy as never);
      json(response, 201, { run });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = message.includes('Another self-heal') ? 409 : 400;
      json(response, code, { error: message });
    }
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/self-heal/status') {
    json(response, 200, {
      active: runtime.listActiveSelfHealRuns()
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/self-heal/runs') {
    const limit = Number(url.searchParams.get('limit') ?? '20');
    json(response, 200, {
      runs: runtime.listSelfHealRuns(Number.isFinite(limit) ? limit : 20)
    });
    return;
  }

  if (request.method === 'GET' && parts[0] === 'api' && parts[1] === 'self-heal' && parts[2] === 'runs' && parts[3]) {
    const runId = parts[3];
    if (parts[4] === 'events') {
      const run = runtime.getSelfHealRun(runId);
      if (!run) throw new NotFoundError('Run');
      const limit = Number(url.searchParams.get('limit') ?? '200');
      json(response, 200, {
        run,
        events: runtime.listSelfHealEvents(runId, Number.isFinite(limit) ? limit : 200)
      });
      return;
    }
    const run = runtime.getSelfHealRun(runId);
    if (!run) throw new NotFoundError('Run');
    json(response, 200, { run });
    return;
  }

  if (request.method === 'POST' && parts[0] === 'api' && parts[1] === 'self-heal' && parts[2] === 'runs' && parts[3]) {
    const runId = parts[3];
    if (parts[4] === 'stop') {
      json(response, 200, { run: runtime.stopSelfHealRun(runId) });
      return;
    }
    if (parts[4] === 'resume') {
      try {
        json(response, 200, { run: runtime.resumeSelfHealRun(runId) });
      } catch (error) {
        throw error instanceof AppError ? error : new NotFoundError(errorMessage(error));
      }
      return;
    }
  }

  if (request.method === 'GET' && url.pathname === '/api/daemon/restart-request') {
    json(response, 200, {
      restartRequest: runtime.getDaemonRestartRequest() ?? null
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/daemon/restart-request/ack') {
    runtime.acknowledgeDaemonRestart();
    json(response, 200, { ok: true });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/agents') {
    runtime.ensureBuiltinAgentsSynced();
    json(response, 200, {
      agents: runtime.listAgents()
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/mailbox') {
    const agentId = url.searchParams.get('agentId');
    if (!agentId) throw new ValidationError('Missing agentId');
    json(response, 200, {
      mail: runtime.listMailbox(agentId, url.searchParams.get('pending') === '1')
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/mailbox/all') {
    const limit = Number(url.searchParams.get('limit') ?? '200');
    json(response, 200, {
      mail: runtime.listAllMailbox(Number.isFinite(limit) ? limit : 200)
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/traces') {
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) throw new ValidationError('Missing sessionId');
    const limit = Number(url.searchParams.get('limit') ?? '500');
    const events = await runtime.listTraceEvents(sessionId, Number.isFinite(limit) ? limit : 500);
    json(response, 200, { sessionId, events });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/mailbox') {
    const body = (await readBody(request)) as Record<string, unknown>;
    const fromAgentId = String(body.fromAgentId ?? '').trim();
    const toAgentId = String(body.toAgentId ?? '').trim();
    const content = String(body.content ?? '').trim();
    if (!fromAgentId || !toAgentId || !content) throw new ValidationError('Missing fromAgentId, toAgentId, or content');

    const mail = runtime.sendMailboxMessage({
      fromAgentId,
      toAgentId,
      content,
      type: typeof body.type === 'string' ? body.type : undefined,
      correlationId: typeof body.correlationId === 'string' ? body.correlationId : undefined,
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
      taskId: typeof body.taskId === 'string' ? body.taskId : undefined
    });

    json(response, 201, {
      mail
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/approvals') {
    json(response, 200, {
      approvals: runtime.listApprovals()
    });
    return;
  }

  if (request.method === 'POST' && parts[0] === 'api' && parts[1] === 'approvals' && parts[2] && parts[3]) {
    const decision = parts[3] === 'reject' ? 'rejected' : 'approved';
    const approval = await runtime.approve(parts[2], decision);
    const session = runtime.getSession(approval.sessionId);
    if (decision === 'approved' && session?.status === 'idle') {
      await runtime.runSession(session.id);
    }
    json(response, 200, {
      approval,
      session: session ? runtime.getSession(session.id) : undefined,
      latestAssistant: session ? runtime.getLatestAssistantText(session.id) : undefined
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/workspaces') {
    json(response, 200, {
      workspaces: runtime.listWorkspaces()
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/background-jobs') {
    json(response, 200, {
      jobs: runtime.listBackgroundJobs()
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/teams') {
    const body = (await readBody(request)) as Record<string, unknown>;
    const name = String(body.name ?? '').trim();
    const role = String(body.role ?? '').trim();
    const prompt = String(body.prompt ?? '').trim();
    if (!name || !role || !prompt) throw new ValidationError('Missing name, role, or prompt');

    const session = runtime.createTeammateSession({
      name,
      role,
      prompt,
      taskId: typeof body.taskId === 'string' ? body.taskId : undefined,
      parentSessionId: typeof body.parentSessionId === 'string' ? body.parentSessionId : undefined,
      background: body.background !== false
    });
    if (body.autoRun !== false) {
      await runtime.runSession(session.id);
    }

    json(response, 201, {
      session: runtime.getSession(session.id),
      latestAssistant: runtime.getLatestAssistantText(session.id)
    });
    return;
  }

  if (request.method === 'POST' && parts[0] === 'api' && parts[1] === 'sessions' && parts[2] && parts[3] === 'run') {
    const sessionId = parts[2];
    const session = await runtime.runSession(sessionId);
    json(response, 200, {
      session,
      latestAssistant: runtime.getLatestAssistantText(sessionId),
      messages: runtime.getSessionMessages(sessionId)
    });
    return;
  }

  if (request.method === 'POST' && parts[0] === 'api' && parts[1] === 'sessions' && parts[2] && parts[3] === 'stream') {
    const sessionId = parts[2];
    const body = (await readBody(request)) as Record<string, unknown>;
    const msg = typeof body.message === 'string' ? body.message.trim() : '';
    const imgIds = imageAssetIdsFromBody(body);
    if (msg || imgIds.length > 0) {
      runtime.sendUserMessage(sessionId, msg || '(image)', { imageAssetIds: imgIds });
    }
    sseInit(response);
    try {
      await runtime.runSession(sessionId, {
        onModelStreamChunk: (chunk) => {
          sseSend(response, 'model', chunk);
        }
      });
      sseSend(response, 'result', {
        session: runtime.getSession(sessionId),
        latestAssistant: runtime.getLatestAssistantText(sessionId)
      });
    } catch (error) {
      sseSend(response, 'error', { message: error instanceof Error ? error.message : String(error) });
    }
    response.end();
    return;
  }

  if (request.method === 'POST' && parts[0] === 'api' && parts[1] === 'sessions' && parts[2] && parts[3] === 'cancel') {
    const sessionId = parts[2];
    runtime.cancelSession(sessionId);
    json(response, 200, { ok: true, sessionId });
    return;
  }

  throw new NotFoundError('Route');
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${host}:${port}`);
  try {
    if (url.pathname.startsWith('/api/')) {
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
  if (!['1', 'true', 'yes'].includes(v)) {
    return;
  }
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

setInterval(async () => {
  try {
    await runtime.runScheduler();
  } catch (error) {
    log.error('scheduler loop failed', error);
  }
}, 1_500).unref();
