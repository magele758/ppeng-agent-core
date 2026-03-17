const sessionsRoot = document.querySelector('#sessions');
const tasksRoot = document.querySelector('#tasks');
const approvalsRoot = document.querySelector('#approvals');
const agentsRoot = document.querySelector('#agents');
const workspacesRoot = document.querySelector('#workspaces');
const taskCount = document.querySelector('#taskCount');
const approvalCount = document.querySelector('#approvalCount');
const sessionCount = document.querySelector('#sessionCount');
const refreshButton = document.querySelector('#refreshButton');
const schedulerButton = document.querySelector('#schedulerButton');
const newSessionButton = document.querySelector('#newSessionButton');
const modeSelect = document.querySelector('#modeSelect');
const chatInput = document.querySelector('#chatInput');
const chatSend = document.querySelector('#chatSend');
const messagesRoot = document.querySelector('#messages');
const conversationTitle = document.querySelector('#conversationTitle');
const conversationMeta = document.querySelector('#conversationMeta');
const sessionTask = document.querySelector('#sessionTask');

let selectedSessionId = null;
let lastOverviewKey = null;

function renderItems(root, items, renderItem, emptyText = 'No data yet') {
  root.innerHTML = '';
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = emptyText;
    root.append(empty);
    return;
  }
  for (const item of items) {
    root.append(renderItem(item));
  }
}

function pill(text, tone = 'default') {
  const node = document.createElement('span');
  node.className = `pill pill-${tone}`;
  node.textContent = text;
  return node;
}

function messageText(parts = []) {
  return parts
    .map((part) => {
      if (part.type === 'text') return part.text ?? '';
      if (part.type === 'tool_call') return `[tool_call ${part.name}]`;
      if (part.type === 'tool_result') return `[tool_result ${part.name}] ${part.content ?? ''}`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

async function loadOverview() {
  const [sessionsResult, tasksResult, approvalsResult, agentsResult, workspacesResult] = await Promise.all([
    fetch('/api/sessions').then((response) => response.json()),
    fetch('/api/tasks').then((response) => response.json()),
    fetch('/api/approvals').then((response) => response.json()),
    fetch('/api/agents').then((response) => response.json()),
    fetch('/api/workspaces').then((response) => response.json())
  ]);

  const sessions = sessionsResult.sessions ?? [];
  const tasks = tasksResult.tasks ?? [];
  const approvals = approvalsResult.approvals ?? [];
  const agents = agentsResult.agents ?? [];
  const workspaces = workspacesResult.workspaces ?? [];

  const dataKey = JSON.stringify({ sessions, tasks, approvals, agents, workspaces });
  if (dataKey === lastOverviewKey) return;
  lastOverviewKey = dataKey;

  sessionCount.textContent = String(sessions.length);
  taskCount.textContent = String(tasks.length);
  approvalCount.textContent = String(approvals.length);

  renderItems(sessionsRoot, sessions, (session) => {
    const node = document.createElement('article');
    node.className = `list-item ${selectedSessionId === session.id ? 'selected' : ''}`;
    node.innerHTML = `
      <div class="title-row">
        <strong>${session.title}</strong>
      </div>
      <div class="meta-row">
        <span>${session.id}</span>
        <span>${session.agentId}</span>
      </div>
    `;
    const tone =
      session.status === 'completed' ? 'success' : session.status === 'waiting_approval' ? 'warning' : 'default';
    node.querySelector('.title-row').append(pill(session.mode), pill(session.status, tone));
    node.addEventListener('click', () => selectSession(session.id));
    return node;
  }, 'No sessions yet');

  renderItems(tasksRoot, tasks, (task) => {
    const node = document.createElement('article');
    node.className = 'list-item';
    node.innerHTML = `
      <div class="title-row">
        <strong>${task.title}</strong>
      </div>
      <div class="meta-row">
        <span>${task.id}</span>
        <span>${task.ownerAgentId ?? '-'}</span>
      </div>
    `;
    const tone = task.status === 'completed' ? 'success' : task.status === 'failed' ? 'warning' : 'default';
    node.querySelector('.title-row').append(pill(task.status, tone));
    if (task.sessionId) {
      node.addEventListener('click', () => selectSession(task.sessionId));
    }
    return node;
  }, 'No tasks yet');

  renderItems(approvalsRoot, approvals, (approval) => {
    const node = document.createElement('article');
    node.className = 'list-item';
    node.innerHTML = `
      <div class="title-row">
        <strong>${approval.toolName}</strong>
      </div>
      <div class="meta-row">
        <span>${approval.sessionId}</span>
        <span>${approval.reason}</span>
      </div>
    `;
    const actions = document.createElement('div');
    actions.className = 'actions';

    const approveButton = document.createElement('button');
    approveButton.textContent = 'Approve';
    approveButton.onclick = async () => {
      await fetch(`/api/approvals/${approval.id}/approve`, { method: 'POST' });
      await loadOverview();
      await refreshSelectedSession();
    };

    const rejectButton = document.createElement('button');
    rejectButton.textContent = 'Reject';
    rejectButton.className = 'secondary';
    rejectButton.onclick = async () => {
      await fetch(`/api/approvals/${approval.id}/reject`, { method: 'POST' });
      await loadOverview();
      await refreshSelectedSession();
    };

    actions.append(approveButton, rejectButton);
    node.append(actions);
    return node;
  }, 'No approvals pending');

  renderItems(agentsRoot, agents, (agent) => {
    const node = document.createElement('article');
    node.className = 'list-item';
    node.innerHTML = `
      <div class="title-row">
        <strong>${agent.id}</strong>
      </div>
      <div class="meta-row">
        <span>${agent.role}</span>
        <span>${(agent.capabilities ?? []).join(', ')}</span>
      </div>
    `;
    return node;
  }, 'No agents registered');

  renderItems(workspacesRoot, workspaces, (workspace) => {
    const node = document.createElement('article');
    node.className = 'list-item';
    node.innerHTML = `
      <div class="title-row">
        <strong>${workspace.name}</strong>
      </div>
      <div class="meta-row">
        <span>${workspace.taskId}</span>
        <span>${workspace.rootPath}</span>
      </div>
    `;
    node.querySelector('.title-row').append(pill(workspace.mode));
    return node;
  }, 'No workspaces yet');
}

async function selectSession(sessionId) {
  selectedSessionId = sessionId;
  await loadOverview();
  await refreshSelectedSession();
}

async function refreshSelectedSession() {
  if (!selectedSessionId) {
    conversationTitle.textContent = 'Conversation';
    conversationMeta.textContent = 'Select a session to inspect messages.';
    sessionTask.classList.add('hidden');
    messagesRoot.className = 'messages empty-state';
    messagesRoot.textContent = 'No session selected.';
    return;
  }

  const response = await fetch(`/api/sessions/${selectedSessionId}`);
  if (!response.ok) {
    selectedSessionId = null;
    await refreshSelectedSession();
    return;
  }

  const data = await response.json();
  const { session, task, messages } = data;
  conversationTitle.textContent = session.title;
  conversationMeta.textContent = `${session.id}  ${session.mode}  ${session.status}  ${session.agentId}`;

  if (task) {
    sessionTask.classList.remove('hidden');
    sessionTask.textContent = `${task.id}  ${task.status}  ${task.title}${task.description ? ` — ${task.description}` : ''}`;
  } else {
    sessionTask.classList.add('hidden');
    sessionTask.textContent = '';
  }

  messagesRoot.innerHTML = '';
  messagesRoot.className = 'messages';
  if (!messages?.length) {
    messagesRoot.classList.add('empty-state');
    messagesRoot.textContent = 'No messages yet.';
    return;
  }

  for (const message of messages) {
    const node = document.createElement('article');
    node.className = `message message-${message.role}`;

    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = message.role;

    const body = document.createElement('pre');
    body.className = 'message-body';
    body.textContent = messageText(message.parts);

    node.append(meta, body);
    messagesRoot.append(node);
  }
}

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';

  if (selectedSessionId) {
    await fetch(`/api/sessions/${selectedSessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    });
    await loadOverview();
    await refreshSelectedSession();
    return;
  }

  if (modeSelect.value === 'task') {
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'task',
        title: text.slice(0, 80),
        message: text,
        autoRun: true,
        background: true
      })
    });
    const data = await response.json();
    selectedSessionId = data.session.id;
  } else {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    });
    const data = await response.json();
    selectedSessionId = data.session.id;
  }

  await loadOverview();
  await refreshSelectedSession();
}

chatSend.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    sendMessage();
  }
});

newSessionButton.addEventListener('click', async () => {
  selectedSessionId = null;
  chatInput.focus();
  await loadOverview();
  await refreshSelectedSession();
});

schedulerButton.addEventListener('click', async () => {
  await fetch('/api/scheduler/run', { method: 'POST' });
  await loadOverview();
  await refreshSelectedSession();
});

refreshButton.addEventListener('click', async () => {
  lastOverviewKey = null;
  await loadOverview();
  await refreshSelectedSession();
});

await loadOverview();
await refreshSelectedSession();
setInterval(async () => {
  await loadOverview();
  await refreshSelectedSession();
}, 2500);
