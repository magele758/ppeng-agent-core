import 'dotenv/config';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output, env, exit } from 'node:process';

const host = env.RAW_AGENT_DAEMON_HOST ?? '127.0.0.1';
const port = Number(env.RAW_AGENT_DAEMON_PORT ?? 7070);
const daemonBaseUrl = `http://${host}:${port}`;

async function request(pathname: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${daemonBaseUrl}${pathname}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init?.headers ?? {})
      }
    });
  } catch (e) {
    const hint =
      e instanceof Error && /fetch failed|ECONNREFUSED|ENOTFOUND/i.test(e.message)
        ? ` (daemon not listening? start with: npm run start:daemon or npm run start:supervised → ${daemonBaseUrl})`
        : '';
    throw new Error(`${e instanceof Error ? e.message : String(e)}${hint}`);
  }

  if (!response.ok) {
    throw new Error(`Daemon request failed with ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

function usage(): void {
  console.log(`raw-agent CLI

Commands:
  chat <message>
  send <sessionId> <message>
  attach <sessionId> <message>   same as send (attach-friendly alias)
  session ls
  session show <sessionId>
  session new [title]            create idle chat session (no auto-run); prints id
  session repl <sessionId>     interactive one line = one user message (quit|exit to stop)
  session team [sessionId]     JSON team tree: all sessions, or subtree for sessionId
  team spawn <name> <role> <prompt...>   POST /api/teams (teammate session)
  task create <title> [description]
  task ls
  task show <taskId>
  approve <approvalId> [approve|reject]
  agent ls
  workspace ls
  scheduler run
  self-heal start [json]   optional policy JSON, e.g. '{"testPreset":"unit","autoMerge":false}'
  self-heal status
  self-heal runs [limit]
  self-heal show <runId>
  self-heal logs <runId>
  self-heal stop <runId>
  self-heal resume <runId>
  daemon restart-status
  daemon restart-ack`);
}

function printMessages(messages: Array<{ role: string; parts: Array<{ type: string; text?: string; content?: string; name?: string }> }>) {
  for (const message of messages) {
    const text = message.parts
      .map((part) => {
        if (part.type === 'text') return part.text ?? '';
        if (part.type === 'tool_call') return `[tool_call ${part.name}]`;
        if (part.type === 'tool_result') return `[tool_result ${part.name}] ${part.content ?? ''}`;
        return '';
      })
      .filter(Boolean)
      .join('\n');
    console.log(`${message.role}: ${text}`);
  }
}

async function main(): Promise<void> {
  const [command, subcommand, ...rest] = process.argv.slice(2);

  if (!command) {
    usage();
    return;
  }

  if (command === 'chat') {
    const message = [subcommand, ...rest].filter(Boolean).join(' ');
    const result = (await request('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message })
    })) as {
      session: { id: string };
      latestAssistant?: string;
    };
    console.log(`${result.session.id}`);
    if (result.latestAssistant) {
      console.log(result.latestAssistant);
    }
    return;
  }

  if (command === 'send' || command === 'attach') {
    const sessionId = subcommand;
    const message = rest.join(' ');
    if (!sessionId || !message) {
      throw new Error(`Usage: ${command} <sessionId> <message>`);
    }
    const result = (await request(`/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message })
    })) as {
      latestAssistant?: string;
    };
    if (result.latestAssistant) {
      console.log(result.latestAssistant);
    }
    return;
  }

  if (command === 'team' && subcommand === 'spawn') {
    const name = rest[0];
    const role = rest[1];
    const prompt = rest.slice(2).join(' ');
    if (!name || !role || !prompt) {
      throw new Error('Usage: team spawn <name> <role> <prompt...>');
    }
    const result = (await request('/api/teams', {
      method: 'POST',
      body: JSON.stringify({ name, role, prompt })
    })) as {
      session: { id: string };
      latestAssistant?: string;
    };
    console.log(result.session.id);
    if (result.latestAssistant) {
      console.log(result.latestAssistant);
    }
    return;
  }

  if (command === 'session' && subcommand === 'new') {
    const title = rest.length > 0 ? rest.join(' ') : 'CLI Session';
    const result = (await request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ title, autoRun: false })
    })) as { session: { id: string } };
    console.log(result.session.id);
    return;
  }

  if (command === 'session' && subcommand === 'repl') {
    const sessionId = rest[0];
    if (!sessionId) {
      throw new Error('Usage: session repl <sessionId>');
    }
    const rl = readline.createInterface({ input, output, terminal: true });
    console.error(`repl on ${sessionId} (quit or exit to stop)`);
    try {
      for (;;) {
        const line = (await rl.question('> ')).trim();
        if (!line) continue;
        if (line === 'quit' || line === 'exit') break;
        const result = (await request(`/api/sessions/${sessionId}/messages`, {
          method: 'POST',
          body: JSON.stringify({ message: line })
        })) as { latestAssistant?: string };
        if (result.latestAssistant) {
          console.log(result.latestAssistant);
        }
      }
    } finally {
      rl.close();
    }
    return;
  }

  if (command === 'session' && subcommand === 'team') {
    const sessionId = rest[0];
    if (sessionId) {
      const data = await request(`/api/sessions/${sessionId}/team`);
      console.log(JSON.stringify(data, null, 2));
    } else {
      const data = await request('/api/sessions/team-overview');
      console.log(JSON.stringify(data, null, 2));
    }
    return;
  }

  if (command === 'session' && subcommand === 'ls') {
    const result = (await request('/api/sessions')) as {
      sessions: Array<{ id: string; mode: string; status: string; agentId: string; title: string }>;
    };
    for (const session of result.sessions) {
      console.log(`${session.id}  ${session.mode.padEnd(9)}  ${session.status.padEnd(18)}  ${session.agentId.padEnd(12)}  ${session.title}`);
    }
    return;
  }

  if (command === 'session' && subcommand === 'show') {
    const sessionId = rest[0];
    if (!sessionId) {
      throw new Error('Missing session id');
    }
    const result = (await request(`/api/sessions/${sessionId}`)) as {
      session: { id: string; mode: string; status: string; title: string; agentId: string };
      latestAssistant?: string;
      messages: Array<{ role: string; parts: Array<{ type: string; text?: string; content?: string; name?: string }> }>;
    };
    console.log(`${result.session.id} ${result.session.mode} ${result.session.status} ${result.session.agentId}`);
    console.log(result.session.title);
    if (result.latestAssistant) {
      console.log(`latest: ${result.latestAssistant}`);
    }
    console.log('');
    printMessages(result.messages);
    return;
  }

  if (command === 'task' && subcommand === 'create') {
    const [title, ...descriptionParts] = rest;
    if (!title) {
      throw new Error('Missing task title');
    }
    const result = (await request('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title,
        description: descriptionParts.join(' ')
      })
    })) as {
      task: { id: string; status: string; title: string };
      latestAssistant?: string;
    };
    console.log(`${result.task.id} ${result.task.status} ${result.task.title}`);
    if (result.latestAssistant) {
      console.log(result.latestAssistant);
    }
    return;
  }

  if (command === 'task' && subcommand === 'ls') {
    const result = (await request('/api/tasks')) as {
      tasks: Array<{ id: string; status: string; ownerAgentId?: string; title: string }>;
    };
    for (const task of result.tasks) {
      console.log(`${task.id}  ${task.status.padEnd(12)}  ${(task.ownerAgentId ?? '-').padEnd(12)}  ${task.title}`);
    }
    return;
  }

  if (command === 'task' && subcommand === 'show') {
    const taskId = rest[0];
    if (!taskId) {
      throw new Error('Missing task id');
    }
    const result = (await request(`/api/tasks/${taskId}`)) as {
      task: { id: string; status: string; title: string; description: string };
      events: Array<{ createdAt: string; kind: string; actor: string }>;
    };
    console.log(`${result.task.id} ${result.task.status}`);
    console.log(result.task.title);
    if (result.task.description) {
      console.log(result.task.description);
    }
    console.log('');
    for (const event of result.events) {
      console.log(`${event.createdAt}  ${event.kind}  ${event.actor}`);
    }
    return;
  }

  if (command === 'approve') {
    const approvalId = subcommand;
    const action = rest[0] === 'reject' ? 'reject' : 'approve';
    if (!approvalId) {
      throw new Error('Missing approval id');
    }
    const result = (await request(`/api/approvals/${approvalId}/${action}`, {
      method: 'POST'
    })) as {
      approval: { id: string; status: string };
    };
    console.log(`${result.approval.id} ${result.approval.status}`);
    return;
  }

  if (command === 'agent' && subcommand === 'ls') {
    const result = (await request('/api/agents')) as {
      agents: Array<{ id: string; role: string; capabilities: string[] }>;
    };
    for (const agent of result.agents) {
      console.log(`${agent.id}  ${agent.role}  ${agent.capabilities.join(', ')}`);
    }
    return;
  }

  if (command === 'workspace' && subcommand === 'ls') {
    const result = (await request('/api/workspaces')) as {
      workspaces: Array<{ id: string; taskId: string; mode: string; rootPath: string }>;
    };
    for (const workspace of result.workspaces) {
      console.log(`${workspace.id}  ${workspace.taskId}  ${workspace.mode}  ${workspace.rootPath}`);
    }
    return;
  }

  if (command === 'scheduler' && subcommand === 'run') {
    await request('/api/scheduler/run', {
      method: 'POST'
    });
    console.log('scheduler cycle completed');
    return;
  }

  if (command === 'self-heal') {
    if (subcommand === 'start') {
      const raw = rest.join(' ').trim();
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          throw new Error('Invalid JSON for self-heal policy (see: self-heal start {"testPreset":"unit"})');
        }
      }
      const payload = body.policy !== undefined ? body : { policy: body };
      const run = (await request('/api/self-heal/start', {
        method: 'POST',
        body: JSON.stringify(payload)
      })) as { run: { id: string; status: string } };
      console.log(`${run.run.id} ${run.run.status}`);
      return;
    }
    if (subcommand === 'status') {
      const data = (await request('/api/self-heal/status')) as { active: Array<{ id: string; status: string }> };
      if (data.active.length === 0) {
        console.log('(no active self-heal runs)');
        return;
      }
      for (const r of data.active) {
        console.log(`${r.id}  ${r.status}`);
      }
      return;
    }
    if (subcommand === 'runs') {
      const limit = rest[0] ? Number(rest[0]) : 10;
      const data = (await request(`/api/self-heal/runs?limit=${Number.isFinite(limit) ? limit : 10}`)) as {
        runs: Array<{ id: string; status: string; updatedAt?: string }>;
      };
      for (const r of data.runs) {
        console.log(`${r.id}  ${r.status}`);
      }
      return;
    }
    if (subcommand === 'show' && rest[0]) {
      const data = (await request(`/api/self-heal/runs/${rest[0]}`)) as { run: Record<string, unknown> };
      console.log(JSON.stringify(data.run, null, 2));
      return;
    }
    if (subcommand === 'logs' && rest[0]) {
      const data = (await request(`/api/self-heal/runs/${rest[0]}/events`)) as {
        events: Array<{ kind: string; createdAt: string; payload: unknown }>;
      };
      for (const e of data.events) {
        console.log(`${e.createdAt}  ${e.kind}  ${JSON.stringify(e.payload)}`);
      }
      return;
    }
    if (subcommand === 'stop' && rest[0]) {
      const data = (await request(`/api/self-heal/runs/${rest[0]}/stop`, { method: 'POST' })) as {
        run: { id: string; status: string };
      };
      console.log(`${data.run.id} ${data.run.status}`);
      return;
    }
    if (subcommand === 'resume' && rest[0]) {
      const data = (await request(`/api/self-heal/runs/${rest[0]}/resume`, { method: 'POST' })) as {
        run: { id: string; status: string };
      };
      console.log(`${data.run.id} ${data.run.status}`);
      return;
    }
    usage();
    return;
  }

  if (command === 'daemon' && subcommand === 'restart-status') {
    const data = (await request('/api/daemon/restart-request')) as { restartRequest: unknown };
    console.log(JSON.stringify(data.restartRequest, null, 2));
    return;
  }
  if (command === 'daemon' && subcommand === 'restart-ack') {
    await request('/api/daemon/restart-request/ack', { method: 'POST' });
    console.log('acknowledged');
    return;
  }

  usage();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
});
