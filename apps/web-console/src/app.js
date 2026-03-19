const sessionsRoot = document.querySelector('#sessions');
const tasksRoot = document.querySelector('#tasks');
const approvalsRoot = document.querySelector('#approvals');
const agentsRoot = document.querySelector('#agents');
const workspacesRoot = document.querySelector('#workspaces');
const mailboxRoot = document.querySelector('#mailbox');
const taskCount = document.querySelector('#taskCount');
const approvalCount = document.querySelector('#approvalCount');
const sessionCount = document.querySelector('#sessionCount');
const refreshButton = document.querySelector('#refreshButton');
const schedulerButton = document.querySelector('#schedulerButton');
const newSessionButton = document.querySelector('#newSessionButton');
const modeSelect = document.querySelector('#modeSelect');
const agentSelect = document.querySelector('#agentSelect');
const chatInput = document.querySelector('#chatInput');
const chatSend = document.querySelector('#chatSend');
const messagesRoot = document.querySelector('#messages');
const conversationTitle = document.querySelector('#conversationTitle');
const conversationMeta = document.querySelector('#conversationMeta');
const sessionTask = document.querySelector('#sessionTask');
const runSessionButton = document.querySelector('#runSessionButton');
const composerStatus = document.querySelector('#composerStatus');
const teammateName = document.querySelector('#teammateName');
const teammateRole = document.querySelector('#teammateRole');
const teammatePrompt = document.querySelector('#teammatePrompt');
const createTeammateButton = document.querySelector('#createTeammateButton');
const teamStatus = document.querySelector('#teamStatus');
const mailFromAgent = document.querySelector('#mailFromAgent');
const mailToAgent = document.querySelector('#mailToAgent');
const mailContent = document.querySelector('#mailContent');
const sendMailButton = document.querySelector('#sendMailButton');
const mailboxAgentSelect = document.querySelector('#mailboxAgentSelect');
const mailboxScope = document.querySelector('#mailboxScope');

let selectedSessionId = null;
let selectedMailboxAgentId = 'main';
let lastOverviewKey = null;

async function api(path, init) {
  const response = await fetch(path, init);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.error ?? `Request failed: ${response.status}`);
  }
  return data;
}

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

function setStatus(root, text, tone = 'default') {
  root.textContent = text;
  root.className = `status-line subtle${tone === 'default' ? '' : ` ${tone}`}`;
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

function syncAgentSelect(select, agents, value, { includeBlank = false } = {}) {
  const nextValue = value && agents.some((agent) => agent.id === value) ? value : agents[0]?.id ?? '';
  const fragment = document.createDocumentFragment();

  if (includeBlank) {
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Select agent';
    fragment.append(blank);
  }

  for (const agent of agents) {
    const option = document.createElement('option');
    option.value = agent.id;
    option.textContent = `${agent.id} · ${agent.role}`;
    if (agent.id === nextValue) {
      option.selected = true;
    }
    fragment.append(option);
  }

  select.innerHTML = '';
  select.append(fragment);
  return nextValue;
}

function syncAgentControls(agents) {
  if (agents.length === 0) {
    return;
  }

  syncAgentSelect(agentSelect, agents, agentSelect.value || 'main');
  syncAgentSelect(mailFromAgent, agents, mailFromAgent.value || 'main');
  syncAgentSelect(mailToAgent, agents, mailToAgent.value || agents.find((agent) => agent.id !== 'main')?.id || agents[0].id);
  selectedMailboxAgentId = syncAgentSelect(mailboxAgentSelect, agents, selectedMailboxAgentId || 'main');
}

function renderMailbox(mail) {
  renderItems(mailboxRoot, mail, (entry) => {
    const node = document.createElement('article');
    node.className = 'list-item';
    node.innerHTML = `
      <div class="title-row">
        <strong>${entry.type}</strong>
      </div>
      <div class="meta-row">
        <span>${entry.fromAgentId} → ${entry.toAgentId}</span>
        <span>${entry.status}</span>
      </div>
      <div class="meta-row">
        <span>${entry.createdAt}</span>
      </div>
    `;
    node.querySelector('.title-row').append(
      pill(entry.status, entry.status === 'pending' ? 'warning' : 'default')
    );

    const body = document.createElement('pre');
    body.className = 'message-body';
    body.textContent = entry.content;
    node.append(body);
    return node;
  }, 'No mailbox messages for this agent');
}

async function loadOverview() {
  const [sessionsResult, tasksResult, approvalsResult, agentsResult, workspacesResult] = await Promise.all([
    api('/api/sessions'),
    api('/api/tasks'),
    api('/api/approvals'),
    api('/api/agents'),
    api('/api/workspaces')
  ]);

  const sessions = sessionsResult.sessions ?? [];
  const tasks = tasksResult.tasks ?? [];
  const approvals = approvalsResult.approvals ?? [];
  const agents = agentsResult.agents ?? [];
  const workspaces = workspacesResult.workspaces ?? [];
  syncAgentControls(agents);

  const mailboxResult = selectedMailboxAgentId
    ? await api(`/api/mailbox?agentId=${encodeURIComponent(selectedMailboxAgentId)}${mailboxScope.value === 'pending' ? '&pending=1' : ''}`)
    : { mail: [] };
  const mail = mailboxResult.mail ?? [];

  const dataKey = JSON.stringify({ sessions, tasks, approvals, agents, workspaces, mail, mailboxScope: mailboxScope.value, selectedMailboxAgentId });
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

  renderMailbox(mail);
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
    runSessionButton.disabled = true;
    return;
  }

  let data;
  try {
    data = await api(`/api/sessions/${selectedSessionId}`);
  } catch {
    selectedSessionId = null;
    await refreshSelectedSession();
    return;
  }

  const { session, task, messages } = data;
  conversationTitle.textContent = session.title;
  conversationMeta.textContent = `${session.id}  ${session.mode}  ${session.status}  ${session.agentId}`;
  runSessionButton.disabled = false;

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

  try {
    if (selectedSessionId) {
      await api(`/api/sessions/${selectedSessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      setStatus(composerStatus, 'Message delivered to the selected session.', 'success');
      await loadOverview();
      await refreshSelectedSession();
      return;
    }

    const payload = {
      mode: modeSelect.value,
      title: text.slice(0, 80),
      message: text,
      agentId: agentSelect.value,
      autoRun: true,
      background: modeSelect.value === 'task'
    };
    const data =
      modeSelect.value === 'task'
        ? await api('/api/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
        : await api('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: text,
              title: text.slice(0, 80),
              agentId: agentSelect.value
            })
          });
    selectedSessionId = data.session.id;
    setStatus(
      composerStatus,
      `${modeSelect.value === 'task' ? 'Task' : 'Chat'} session started with agent ${data.session.agentId}.`,
      'success'
    );
    await loadOverview();
    await refreshSelectedSession();
  } catch (error) {
    setStatus(composerStatus, error instanceof Error ? error.message : String(error), 'error');
  }
}

async function createTeammate() {
  const name = teammateName.value.trim();
  const role = teammateRole.value.trim();
  const prompt = teammatePrompt.value.trim();
  if (!name || !role || !prompt) {
    setStatus(teamStatus, 'Name, role, and startup prompt are required.', 'error');
    return;
  }

  try {
    const data = await api('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, role, prompt, autoRun: true, background: true })
    });
    selectedSessionId = data.session.id;
    setStatus(teamStatus, `Teammate ${name} is live in session ${data.session.id}.`, 'success');
    teammatePrompt.value = '';
    await loadOverview();
    await refreshSelectedSession();
  } catch (error) {
    setStatus(teamStatus, error instanceof Error ? error.message : String(error), 'error');
  }
}

async function sendMail() {
  const content = mailContent.value.trim();
  if (!mailFromAgent.value || !mailToAgent.value || !content) {
    setStatus(teamStatus, 'Mailbox send requires from, to, and message content.', 'error');
    return;
  }

  try {
    await api('/api/mailbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromAgentId: mailFromAgent.value,
        toAgentId: mailToAgent.value,
        content
      })
    });
    await api('/api/scheduler/run', { method: 'POST' });
    mailContent.value = '';
    selectedMailboxAgentId = mailToAgent.value;
    mailboxAgentSelect.value = mailToAgent.value;
    setStatus(teamStatus, `Mailbox message sent to ${mailToAgent.value} and scheduler was triggered.`, 'success');
    await loadOverview();
    await refreshSelectedSession();
  } catch (error) {
    setStatus(teamStatus, error instanceof Error ? error.message : String(error), 'error');
  }
}

async function runSelectedSession() {
  if (!selectedSessionId) return;
  try {
    await api(`/api/sessions/${selectedSessionId}/run`, { method: 'POST' });
    await loadOverview();
    await refreshSelectedSession();
  } catch (error) {
    setStatus(composerStatus, error instanceof Error ? error.message : String(error), 'error');
  }
}

chatSend.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    sendMessage();
  }
});

createTeammateButton.addEventListener('click', createTeammate);
sendMailButton.addEventListener('click', sendMail);
runSessionButton.addEventListener('click', runSelectedSession);

newSessionButton.addEventListener('click', async () => {
  selectedSessionId = null;
  chatInput.focus();
  setStatus(composerStatus, 'Create a chat or task session with any registered agent.');
  await loadOverview();
  await refreshSelectedSession();
});

schedulerButton.addEventListener('click', async () => {
  await api('/api/scheduler/run', { method: 'POST' });
  await loadOverview();
  await refreshSelectedSession();
});

refreshButton.addEventListener('click', async () => {
  lastOverviewKey = null;
  await loadOverview();
  await refreshSelectedSession();
});

mailboxAgentSelect.addEventListener('change', async () => {
  selectedMailboxAgentId = mailboxAgentSelect.value;
  lastOverviewKey = null;
  await loadOverview();
});

mailboxScope.addEventListener('change', async () => {
  lastOverviewKey = null;
  await loadOverview();
});

await loadOverview();
await refreshSelectedSession();
setInterval(async () => {
  await loadOverview();
  await refreshSelectedSession();
}, 2500);
