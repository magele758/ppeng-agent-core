import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RawAgentRuntime } from '@ppeng/agent-core';
import { loadGatewayFileConfig, parseGatewayEnv } from './config.js';
import { maybeRunScheduledLearn, runLearnCycle } from './learn.js';
import {
  handleFeishuEventRequest,
  handleWeComBridgeRequest,
  runAgentTurnAndReply
} from './im-handlers.js';
import { readGatewayState } from './state.js';
import type { GatewayEnvOptions, GatewayFileConfig } from './types.js';

export interface GatewayHandleContext {
  runtime: RawAgentRuntime;
  repoRoot: string;
  stateDir: string;
  env: GatewayEnvOptions;
  /** Mutable; reload-config updates this ref */
  fileConfigRef: { current: GatewayFileConfig };
}

async function readJsonBody(request: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buf = Buffer.from(chunk);
    total += buf.length;
    if (total > limit) {
      throw Object.assign(new Error('Payload too large'), { code: 'PAYLOAD_TOO_LARGE' });
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
    throw new SyntaxError('Invalid JSON');
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body, null, 2));
}

function checkAuth(request: IncomingMessage, token?: string): boolean {
  if (!token) {
    return true;
  }
  const h = request.headers['x-gateway-token'];
  if (typeof h === 'string' && h === token) {
    return true;
  }
  const auth = request.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7) === token;
  }
  return false;
}

function gatewayPathParts(pathname: string, prefix: string): string[] | null {
  const p = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  if (!pathname.startsWith(p)) {
    return null;
  }
  const rest = pathname.slice(p.length);
  if (rest !== '' && rest !== '/' && !rest.startsWith('/')) {
    return null;
  }
  const tail = rest.replace(/^\//, '') || '';
  return tail ? tail.split('/').filter(Boolean) : [];
}

export async function handleGatewayHttp(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: GatewayHandleContext,
  readBodyLimit = 2_000_000
): Promise<boolean> {
  const url = new URL(request.url ?? '/', 'http://local');
  const parts = gatewayPathParts(url.pathname, ctx.env.pathPrefix);
  if (parts === null) {
    return false;
  }

  const gatewayDir = `${ctx.stateDir}/gateway`;
  const fc = ctx.fileConfigRef.current;
  const isPlatformPath =
    (parts[0] === 'providers' && parts[1] === 'feishu' && parts[2] === 'events') ||
    (parts[0] === 'providers' && parts[1] === 'wecom' && parts[2] === 'bridge');

  if (!isPlatformPath && !checkAuth(request, ctx.env.authToken)) {
    json(response, 401, { error: 'Unauthorized' });
    return true;
  }

  try {
    if (request.method === 'POST' && parts[0] === 'providers' && parts[1] === 'feishu' && parts[2] === 'events') {
      const spec = fc.providers?.feishu;
      if (!spec?.enabled) {
        json(response, 404, { error: 'Feishu provider disabled' });
        return true;
      }
      const body = (await readJsonBody(request, readBodyLimit)) as Record<string, unknown>;
      const out = await handleFeishuEventRequest({
        body,
        spec,
        runtime: ctx.runtime,
        gatewayDir,
        channels: fc.channels ?? []
      });
      if (out.kind === 'challenge') {
        response.statusCode = 200;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.end(JSON.stringify({ challenge: out.challenge }));
        return true;
      }
      if (out.kind === 'json') {
        json(response, out.status, out.body);
        return true;
      }
      response.statusCode = out.status;
      response.end();
      return true;
    }

    if (request.method === 'POST' && parts[0] === 'providers' && parts[1] === 'wecom' && parts[2] === 'bridge') {
      const spec = fc.providers?.wecom;
      if (!spec?.enabled) {
        json(response, 404, { error: 'WeCom provider disabled' });
        return true;
      }
      const body = (await readJsonBody(request, readBodyLimit)) as Record<string, unknown>;
      const out = await handleWeComBridgeRequest({
        body,
        spec,
        runtime: ctx.runtime,
        gatewayDir,
        channels: fc.channels ?? []
      });
      json(response, out.status, out.body);
      return true;
    }

    if (request.method === 'POST' && parts[0] === 'agents' && parts[2] === 'invoke' && parts[1]) {
      const agentId = parts[1];
      const routes = fc.agentRoutes ?? [];
      const route = routes.find((r) => r.agentId === agentId);
      if (!route) {
        json(response, 404, { error: 'Unknown agent route' });
        return true;
      }
      if (route.routeKey) {
        const got = request.headers['x-agent-route-key'];
        if (typeof got !== 'string' || got !== route.routeKey) {
          json(response, 401, { error: 'Invalid X-Agent-Route-Key' });
          return true;
        }
      }
      if (!ctx.runtime.listAgents().some((a) => a.id === agentId)) {
        json(response, 404, { error: 'Agent not registered' });
        return true;
      }
      const body = (await readJsonBody(request, readBodyLimit)) as Record<string, unknown>;
      const message = String(body.message ?? '').trim();
      if (!message) {
        json(response, 400, { error: 'Missing message' });
        return true;
      }
      const userKey = String(body.userKey ?? 'default').trim() || 'default';
      const state = await readGatewayState(gatewayDir);
      const sticky = body.stickySession !== false && route.stickySession !== false;
      const { sessionId } = await runAgentTurnAndReply({
        runtime: ctx.runtime,
        gatewayDir,
        state,
        sessionKey: `invoke:${agentId}:${userKey}`,
        userText: message,
        agentId,
        stickySession: sticky,
        reply: async () => {
          /* internal invoke: HTTP response carries assistant text */
        }
      });
      json(response, 200, {
        agentId,
        sessionId,
        latestAssistant: ctx.runtime.getLatestAssistantText(sessionId)
      });
      return true;
    }

    if (request.method === 'GET' && parts[0] === 'health') {
      json(response, 200, { ok: true, gateway: true, prefix: ctx.env.pathPrefix });
      return true;
    }

    if (request.method === 'GET' && parts[0] === 'agents') {
      json(response, 200, { agents: ctx.runtime.listAgents() });
      return true;
    }

    if (request.method === 'POST' && parts[0] === 'chat') {
      const body = (await readJsonBody(request, readBodyLimit)) as Record<string, unknown>;
      const message = String(body.message ?? '').trim();
      if (!message) {
        json(response, 400, { error: 'Missing message' });
        return true;
      }
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
      const session = sessionId
        ? ctx.runtime.sendUserMessage(sessionId, message)
        : ctx.runtime.createChatSession({
            title: typeof body.title === 'string' ? body.title : 'Gateway Chat',
            message,
            agentId: typeof body.agentId === 'string' ? body.agentId : undefined,
            background: false
          });
      await ctx.runtime.runSession(session.id);
      json(response, 200, {
        session: ctx.runtime.getSession(session.id),
        latestAssistant: ctx.runtime.getLatestAssistantText(session.id)
      });
      return true;
    }

    if (request.method === 'POST' && parts[0] === 'task') {
      const body = (await readJsonBody(request, readBodyLimit)) as Record<string, unknown>;
      const title = String(body.title ?? '').trim();
      if (!title) {
        json(response, 400, { error: 'Missing title' });
        return true;
      }
      const result = ctx.runtime.createTaskSession({
        title,
        description: typeof body.description === 'string' ? body.description : undefined,
        message: typeof body.message === 'string' ? body.message : undefined,
        agentId: typeof body.agentId === 'string' ? body.agentId : undefined,
        blockedBy: Array.isArray(body.blockedBy) ? body.blockedBy.map(String) : undefined,
        background: body.background !== false
      });
      if (body.autoRun !== false) {
        await ctx.runtime.runSession(result.session.id);
      }
      json(response, 201, {
        task: ctx.runtime.getTask(result.task.id),
        session: ctx.runtime.getSession(result.session.id),
        latestAssistant: ctx.runtime.getLatestAssistantText(result.session.id)
      });
      return true;
    }

    if (request.method === 'POST' && parts[0] === 'mailbox') {
      const body = (await readJsonBody(request, readBodyLimit)) as Record<string, unknown>;
      const fromAgentId = String(body.fromAgentId ?? '').trim();
      const toAgentId = String(body.toAgentId ?? '').trim();
      const content = String(body.content ?? '').trim();
      if (!fromAgentId || !toAgentId || !content) {
        json(response, 400, { error: 'Missing fromAgentId, toAgentId, or content' });
        return true;
      }
      const mail = ctx.runtime.sendMailboxMessage({
        fromAgentId,
        toAgentId,
        content,
        type: typeof body.type === 'string' ? body.type : undefined,
        correlationId: typeof body.correlationId === 'string' ? body.correlationId : undefined
      });
      json(response, 201, { mail });
      return true;
    }

    if (request.method === 'POST' && parts[0] === 'scheduler' && parts[1] === 'run') {
      await ctx.runtime.runScheduler();
      json(response, 200, { ok: true });
      return true;
    }

    if (request.method === 'GET' && parts[0] === 'skills' && parts[1] === 'digest') {
      const state = await readGatewayState(gatewayDir);
      json(response, 200, {
        markdown: state.lastDigestMarkdown ?? '',
        lastRun: state.lastLearnRunDateUtc ?? null
      });
      return true;
    }

    if (request.method === 'POST' && parts[0] === 'learn' && parts[1] === 'run') {
      const fc = ctx.fileConfigRef.current;
      const learn = fc.learn;
      if (!learn?.feeds?.length) {
        json(response, 400, { error: 'Configure learn.feeds in gateway.config.json' });
        return true;
      }
      const result = await runLearnCycle({
        repoRoot: ctx.repoRoot,
        gatewayStateDir: gatewayDir,
        runtime: ctx.runtime,
        learn,
        channels: fc.channels ?? []
      });
      json(response, result.ok ? 200 : 502, result);
      return true;
    }

    if (request.method === 'POST' && parts[0] === 'admin' && parts[1] === 'reload-config') {
      const next = (await loadGatewayFileConfig(ctx.env.configPath!)) ?? {};
      ctx.fileConfigRef.current = next;
      json(response, 200, { ok: true });
      return true;
    }
  } catch (e) {
    const code = e instanceof Error && (e as { code?: string }).code === 'PAYLOAD_TOO_LARGE' ? 413 : 500;
    json(response, code, { error: e instanceof Error ? e.message : String(e) });
    return true;
  }

  json(response, 404, { error: 'Not found' });
  return true;
}

const TICK_MS = 60_000;

export function startGatewayLearnTicker(
  getCtx: () => GatewayHandleContext | null,
  onError?: (e: unknown) => void
): ReturnType<typeof setInterval> {
  return setInterval(() => {
    const ctx = getCtx();
    const fc = ctx?.fileConfigRef.current;
    if (!ctx?.env.learnEnabled || !fc?.learn?.feeds?.length) {
      return;
    }
    void maybeRunScheduledLearn({
      repoRoot: ctx.repoRoot,
      gatewayStateDir: `${ctx.stateDir}/gateway`,
      runtime: ctx.runtime,
      learn: fc.learn,
      channels: fc.channels ?? [],
      hourUtc: ctx.env.learnDailyHourUtc
    }).catch((e) => onError?.(e));
  }, TICK_MS);
}

export async function createGatewayContext(
  runtime: RawAgentRuntime,
  repoRoot: string,
  stateDir: string
): Promise<GatewayHandleContext | null> {
  const env = parseGatewayEnv(repoRoot);
  if (!env.enabled) {
    return null;
  }
  const fileConfig = (await loadGatewayFileConfig(env.configPath!)) ?? {};
  return { runtime, repoRoot, stateDir, env, fileConfigRef: { current: fileConfig } };
}
