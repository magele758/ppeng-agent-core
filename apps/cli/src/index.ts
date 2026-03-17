import 'dotenv/config';
import { env, exit } from 'node:process';

const host = env.RAW_AGENT_DAEMON_HOST ?? '127.0.0.1';
const port = Number(env.RAW_AGENT_DAEMON_PORT ?? 7070);
const daemonBaseUrl = `http://${host}:${port}`;

async function request(pathname: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${daemonBaseUrl}${pathname}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {})
    }
  });

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
  session ls
  session show <sessionId>
  task create <title> [description]
  task ls
  task show <taskId>
  approve <approvalId> [approve|reject]
  agent ls
  workspace ls
  scheduler run`);
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

  if (command === 'send') {
    const sessionId = subcommand;
    const message = rest.join(' ');
    if (!sessionId || !message) {
      throw new Error('Usage: send <sessionId> <message>');
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

  usage();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
});
