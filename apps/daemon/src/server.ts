import 'dotenv/config';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { cwd, env } from 'node:process';
import { RawAgentRuntime } from '@raw-agent/core';

const repoRoot = cwd();
const stateDir = env.RAW_AGENT_STATE_DIR ?? join(repoRoot, '.agent-state');
const host = env.RAW_AGENT_DAEMON_HOST ?? '127.0.0.1';
const port = Number(env.RAW_AGENT_DAEMON_PORT ?? 7070);
const runtime = new RawAgentRuntime({
  repoRoot,
  stateDir
});

function json(response: ServerResponse<IncomingMessage>, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body, null, 2));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

async function serveStatic(pathname: string, response: ServerResponse<IncomingMessage>) {
  const sourcePath =
    pathname === '/' || pathname === ''
      ? join(repoRoot, 'apps/web-console/src/index.html')
      : join(repoRoot, 'apps/web-console/src', pathname.replace(/^\//, ''));

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

async function handleApi(request: IncomingMessage, response: ServerResponse<IncomingMessage>) {
  const url = new URL(request.url ?? '/', `http://${host}:${port}`);
  const parts = splitPath(url.pathname);

  if (request.method === 'GET' && url.pathname === '/api/health') {
    json(response, 200, {
      ok: true,
      adapter: runtime.modelAdapter.name
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/sessions') {
    json(response, 200, {
      sessions: runtime.listSessions()
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/chat') {
    const body = (await readBody(request)) as Record<string, unknown>;
    const message = String(body.message ?? '').trim();
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
    if (!message) {
      json(response, 400, { error: 'Missing message' });
      return;
    }

    const session = sessionId
      ? runtime.sendUserMessage(sessionId, message)
      : runtime.createChatSession({
          title: typeof body.title === 'string' ? body.title : 'Chat Session',
          message,
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
      agentId: typeof body.agentId === 'string' ? body.agentId : undefined,
      background: body.background === true
    });
    if (body.autoRun !== false && body.message) {
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
    if (!sessionId) {
      json(response, 400, { error: 'Missing session id' });
      return;
    }
    const body = (await readBody(request)) as Record<string, unknown>;
    const message = String(body.message ?? '').trim();
    if (!message) {
      json(response, 400, { error: 'Missing message' });
      return;
    }
    runtime.sendUserMessage(sessionId, message);
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
    if (!session) {
      json(response, 404, { error: 'Session not found' });
      return;
    }
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

  if (request.method === 'POST' && url.pathname === '/api/tasks') {
    const body = (await readBody(request)) as Record<string, unknown>;
    const result = runtime.createTaskSession({
      title: String(body.title ?? body.goal ?? 'Task'),
      description: typeof body.description === 'string' ? body.description : undefined,
      message: typeof body.message === 'string' ? body.message : typeof body.goal === 'string' ? body.goal : undefined,
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
    if (!task) {
      json(response, 404, { error: 'Task not found' });
      return;
    }
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

  if (request.method === 'GET' && url.pathname === '/api/agents') {
    json(response, 200, {
      agents: runtime.listAgents()
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/mailbox') {
    const agentId = url.searchParams.get('agentId');
    if (!agentId) {
      json(response, 400, { error: 'Missing agentId' });
      return;
    }
    json(response, 200, {
      mail: runtime.listMailbox(agentId, url.searchParams.get('pending') === '1')
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/mailbox') {
    const body = (await readBody(request)) as Record<string, unknown>;
    const fromAgentId = String(body.fromAgentId ?? '').trim();
    const toAgentId = String(body.toAgentId ?? '').trim();
    const content = String(body.content ?? '').trim();
    if (!fromAgentId || !toAgentId || !content) {
      json(response, 400, { error: 'Missing fromAgentId, toAgentId, or content' });
      return;
    }

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
    if (!name || !role || !prompt) {
      json(response, 400, { error: 'Missing name, role, or prompt' });
      return;
    }

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

  json(response, 404, {
    error: 'Not found'
  });
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
    json(response, 500, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(port, host, () => {
  console.log(`raw-agent daemon listening on http://${host}:${port}`);
});

setInterval(async () => {
  try {
    await runtime.runScheduler();
  } catch (error) {
    console.error('scheduler loop failed', error);
  }
}, 1_500).unref();
