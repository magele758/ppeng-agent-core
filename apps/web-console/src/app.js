/** Agent Lab — full-capability debug console */

const $ = (sel) => document.querySelector(sel);

let selectedSessionId = null;
let agents = [];
let sessions = [];
let lastGraphKey = '';

function api(path, init) {
  return fetch(path, init).then(async (response) => {
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { _raw: text };
    }
    if (!response.ok) {
      throw new Error(data.error ?? `HTTP ${response.status}`);
    }
    return data;
  });
}

function setTab(name) {
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === name);
    t.setAttribute('aria-selected', t.dataset.tab === name ? 'true' : 'false');
  });
  document.querySelectorAll('.panel').forEach((p) => {
    p.hidden = !p.id.endsWith(name);
    p.classList.toggle('active', p.id.endsWith(name));
  });
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => setTab(tab.dataset.tab));
});

function pill(text, cls = '') {
  const s = document.createElement('span');
  s.className = `pill ${cls}`;
  s.textContent = text;
  return s;
}

function msgPartsToText(parts = []) {
  return parts
    .map((p) => {
      if (p.type === 'text') return p.text ?? '';
      if (p.type === 'tool_call') return `[${p.name}] ${JSON.stringify(p.input ?? {})}`;
      if (p.type === 'tool_result') return `[result ${p.name}] ${p.content ?? ''}`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function renderMessages(container, messages, { streamNote } = {}) {
  container.innerHTML = '';
  if (streamNote) {
    const d = document.createElement('div');
    d.className = 'msg msg-stream';
    d.innerHTML = `<div class="msg-meta">stream</div><pre class="mono">${escapeHtml(streamNote)}</pre>`;
    container.append(d);
  }
  if (!messages?.length && !streamNote) {
    container.innerHTML = '<div class="empty-hint">暂无消息</div>';
    return;
  }
  for (const m of messages ?? []) {
    const div = document.createElement('div');
    div.className = `msg msg-${m.role}`;
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.textContent = m.role;
    const pre = document.createElement('pre');
    pre.style.margin = '0';
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.fontFamily = 'var(--mono)';
    pre.style.fontSize = '0.82rem';
    pre.textContent = msgPartsToText(m.parts);
    div.append(meta, pre);
    container.append(div);
  }
  container.scrollTop = container.scrollHeight;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function syncAgentSelects() {
  const fills = [$('#agentSelect'), $('#mailFrom'), $('#mailTo')];
  for (const sel of fills) {
    if (!sel) continue;
    const v = sel.value;
    sel.innerHTML = '';
    for (const a of agents) {
      const o = document.createElement('option');
      o.value = a.id;
      o.textContent = `${a.id} · ${a.role}`;
      sel.append(o);
    }
    if (v && agents.some((a) => a.id === v)) sel.value = v;
    else if (sel.id === 'mailTo' && agents.length > 1) {
      sel.value = agents.find((a) => a.id !== 'main')?.id ?? agents[0].id;
    } else if (agents[0]) sel.value = agents[0].id;
  }
}

async function refreshMeta() {
  try {
    const [ver, health] = await Promise.all([api('/api/version'), api('/api/health')]);
    $('#serverMeta').innerHTML = `<span class="chip chip-ok">${escapeHtml(ver.name)} v${escapeHtml(ver.version)}</span>
      <span class="chip chip-muted">${escapeHtml(health.adapter)}</span>`;
  } catch {
    $('#serverMeta').innerHTML = '<span class="chip chip-muted">API 不可用</span>';
  }
}

async function loadOverview() {
  const [sess, tasks, appr, ag, ws, jobs] = await Promise.all([
    api('/api/sessions'),
    api('/api/tasks'),
    api('/api/approvals'),
    api('/api/agents'),
    api('/api/workspaces'),
    api('/api/background-jobs')
  ]);

  sessions = sess.sessions ?? [];
  agents = ag.agents ?? [];
  syncAgentSelects();

  $('#countSessions').textContent = String(sessions.length);
  $('#countTasks').textContent = String((tasks.tasks ?? []).length);
  $('#countApprovals').textContent = String((appr.approvals ?? []).length);

  renderSessionList($('#listSessions'), sessions, { tall: true });
  renderSessionList($('#sessionListMini'), sessions, { tall: false });
  renderTasks($('#listTasks'), tasks.tasks ?? []);
  renderApprovals($('#listApprovals'), appr.approvals ?? []);
  renderSimpleList($('#listJobs'), jobs.jobs ?? [], (j) => `${j.command?.slice(0, 40)}… · ${j.status}`);
  renderSimpleList($('#listWorkspaces'), ws.workspaces ?? [], (w) => `${w.name} · ${w.mode}`);

  await refreshTeamGraph();
  await loadMailAll();

  const traceSel = $('#traceSessionSelect');
  const cur = traceSel.value;
  traceSel.innerHTML = '';
  for (const s of sessions) {
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = `${s.title.slice(0, 36)} (${s.mode})`;
    traceSel.append(o);
  }
  if (selectedSessionId && sessions.some((s) => s.id === selectedSessionId)) {
    traceSel.value = selectedSessionId;
  } else if (cur && sessions.some((s) => s.id === cur)) {
    traceSel.value = cur;
  }
}

function renderSessionList(root, list, { tall }) {
  root.innerHTML = '';
  if (!list.length) {
    root.innerHTML = '<div class="empty-hint">无会话</div>';
    return;
  }
  for (const s of list) {
    const el = document.createElement('div');
    el.className = `list-item ${selectedSessionId === s.id ? 'selected' : ''}`;
    el.innerHTML = `<div class="row"><strong>${escapeHtml(s.title)}</strong></div>
      <div class="row muted" style="font-size:0.75rem">${escapeHtml(s.id.slice(0, 12))}…</div>`;
    el.querySelector('.row').append(pill(s.mode), pill(s.status, s.status === 'waiting_approval' ? 'pill-warn' : s.status === 'completed' ? 'pill-ok' : ''));
    el.addEventListener('click', () => selectSession(s.id));
    root.append(el);
  }
  if (tall) root.scrollTop = 0;
}

function renderTasks(root, tasks) {
  root.innerHTML = '';
  if (!tasks.length) {
    root.innerHTML = '<div class="empty-hint">无任务</div>';
    return;
  }
  for (const t of tasks) {
    const el = document.createElement('div');
    el.className = 'list-item';
    el.innerHTML = `<div class="row"><strong>${escapeHtml(t.title)}</strong>${t.status}</div>
      <div class="row muted" style="font-size:0.75rem">${t.ownerAgentId ?? '—'}</div>`;
    if (t.sessionId) el.addEventListener('click', () => selectSession(t.sessionId));
    root.append(el);
  }
}

function renderApprovals(root, list) {
  root.innerHTML = '';
  if (!list.length) {
    root.innerHTML = '<div class="empty-hint">无审批</div>';
    return;
  }
  for (const a of list) {
    const el = document.createElement('div');
    el.className = 'list-item';
    el.innerHTML = `<div class="row"><strong>${escapeHtml(a.toolName)}</strong></div>
      <div class="muted" style="font-size:0.75rem">${escapeHtml(a.sessionId)}</div>`;
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.marginTop = '8px';
    const b1 = document.createElement('button');
    b1.className = 'btn btn-primary btn-sm';
    b1.textContent = '批准';
    b1.onclick = async () => {
      await api(`/api/approvals/${a.id}/approve`, { method: 'POST' });
      await tick();
    };
    const b2 = document.createElement('button');
    b2.className = 'btn btn-ghost btn-sm';
    b2.textContent = '拒绝';
    b2.onclick = async () => {
      await api(`/api/approvals/${a.id}/reject`, { method: 'POST' });
      await tick();
    };
    row.append(b1, b2);
    el.append(row);
    root.append(el);
  }
}

function renderSimpleList(root, items, fmt) {
  root.innerHTML = '';
  if (!items.length) {
    root.innerHTML = '<div class="empty-hint">无数据</div>';
    return;
  }
  for (const it of items) {
    const el = document.createElement('div');
    el.className = 'list-item';
    el.style.cursor = 'default';
    el.textContent = fmt(it);
    root.append(el);
  }
}

async function selectSession(id) {
  selectedSessionId = id;
  $('#btnRunSession').disabled = !id;
  $('#btnCancelSession').disabled = !id;
  await loadOverview();
  await refreshPlayPanel();
}

async function refreshPlayPanel() {
  const title = $('#playTitle');
  const meta = $('#playMeta');
  const msgs = $('#playMessages');
  if (!selectedSessionId) {
    title.textContent = '选择或创建会话';
    meta.textContent = '';
    msgs.innerHTML = '<div class="empty-hint">从左侧选择会话，或在下方输入新建</div>';
    $('#btnRunSession').disabled = true;
    $('#btnCancelSession').disabled = true;
    return;
  }
  try {
    const data = await api(`/api/sessions/${selectedSessionId}`);
    const s = data.session;
    title.textContent = s.title;
    meta.textContent = `${s.mode} · ${s.status} · agent ${s.agentId}`;
    renderMessages(msgs, data.messages);
  } catch {
    selectedSessionId = null;
    await refreshPlayPanel();
  }
}

async function sendPlayMessage() {
  const text = $('#playInput').value.trim();
  if (!text) return;
  const st = $('#playStatus');
  st.textContent = '';
  st.className = 'status-line';

  try {
    if (selectedSessionId) {
      if ($('#useStream').checked) {
        await streamSession(selectedSessionId, text);
      } else {
        await api(`/api/sessions/${selectedSessionId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text })
        });
      }
      $('#playInput').value = '';
      st.textContent = '已发送';
      st.classList.add('ok');
    } else {
      const mode = $('#modeSelect').value;
      const agentId = $('#agentSelect').value;
      if (mode === 'chat') {
        if ($('#useStream').checked) {
          const res = await fetch('/api/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text, title: text.slice(0, 60), agentId })
          });
          let acc = '';
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const parts = buf.split('\n\n');
            buf = parts.pop() ?? '';
            for (const block of parts) {
              const m = block.match(/^event:\s*(\S+)\ndata:\s*(.+)$/ms);
              if (!m) continue;
              const payload = JSON.parse(m[2]);
              if (m[1] === 'model' && payload.type === 'text_delta') acc += payload.text ?? '';
              if (m[1] === 'result' && payload.session) selectedSessionId = payload.session.id;
            }
          }
          $('#playInput').value = '';
          st.textContent = '流式完成';
          st.classList.add('ok');
        } else {
          const data = await api('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text, title: text.slice(0, 60), agentId })
          });
          selectedSessionId = data.session.id;
          $('#playInput').value = '';
          st.textContent = '会话已创建';
          st.classList.add('ok');
        }
      } else {
        const data = await api('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'task',
            title: text.slice(0, 80),
            message: text,
            agentId,
            autoRun: true,
            background: true
          })
        });
        selectedSessionId = data.session.id;
        $('#playInput').value = '';
        st.textContent = '任务会话已创建';
        st.classList.add('ok');
      }
    }
    await tick();
    await refreshPlayPanel();
  } catch (e) {
    st.textContent = e instanceof Error ? e.message : String(e);
    st.classList.add('err');
  }
}

async function streamSession(sessionId, message) {
  const res = await fetch(`/api/sessions/${sessionId}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message })
  });
  let acc = '';
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const msgs = $('#playMessages');
  msgs.innerHTML = '';
  const live = document.createElement('div');
  live.className = 'msg msg-assistant';
  live.innerHTML = '<div class="msg-meta">assistant (streaming)</div><pre class="mono stream-pre"></pre>';
  msgs.append(live);
  const pre = live.querySelector('.stream-pre');
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const block of parts) {
      const m = block.match(/^event:\s*(\S+)\ndata:\s*(.+)$/ms);
      if (!m) continue;
      const payload = JSON.parse(m[2]);
      if (m[1] === 'model' && payload.type === 'text_delta') {
        acc += payload.text ?? '';
        pre.textContent = acc;
        msgs.scrollTop = msgs.scrollHeight;
      }
    }
  }
}

$('#btnSend').addEventListener('click', sendPlayMessage);
$('#playInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendPlayMessage();
  }
});

$('#btnRunSession').addEventListener('click', async () => {
  if (!selectedSessionId) return;
  try {
    await api(`/api/sessions/${selectedSessionId}/run`, { method: 'POST' });
    await tick();
    await refreshPlayPanel();
  } catch (e) {
    $('#playStatus').textContent = String(e.message);
    $('#playStatus').className = 'status-line err';
  }
});

$('#btnCancelSession').addEventListener('click', async () => {
  if (!selectedSessionId) return;
  await api(`/api/sessions/${selectedSessionId}/cancel`, { method: 'POST' });
  await tick();
});

$('#btnNewSession').addEventListener('click', async () => {
  selectedSessionId = null;
  await loadOverview();
  await refreshPlayPanel();
});

$('#btnScheduler').addEventListener('click', async () => {
  await api('/api/scheduler/run', { method: 'POST' });
  await tick();
});

$('#btnRefresh').addEventListener('click', () => tick());

$('#btnSpawnTeammate').addEventListener('click', async () => {
  const name = $('#tmName').value.trim();
  const role = $('#tmRole').value.trim();
  const prompt = $('#tmPrompt').value.trim();
  if (!name || !role || !prompt) return;
  const data = await api('/api/teams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, role, prompt, autoRun: true, background: true })
  });
  selectedSessionId = data.session.id;
  $('#tmPrompt').value = '';
  await tick();
  setTab('play');
});

$('#btnSendMail').addEventListener('click', async () => {
  const body = $('#mailBody').value.trim();
  if (!body) return;
  await api('/api/mailbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fromAgentId: $('#mailFrom').value,
      toAgentId: $('#mailTo').value,
      content: body
    })
  });
  await api('/api/scheduler/run', { method: 'POST' });
  $('#mailBody').value = '';
  await tick();
  setTab('teams');
});

$('#btnLoadTrace').addEventListener('click', loadTrace);
$('#btnTeamsRefresh').addEventListener('click', refreshTeamGraph);

async function loadTrace() {
  const sid = $('#traceSessionSelect').value;
  const box = $('#traceTimeline');
  if (!sid) {
    box.innerHTML = '<div class="empty-hint">无会话</div>';
    return;
  }
  try {
    const { events } = await api(`/api/traces?sessionId=${encodeURIComponent(sid)}&limit=500`);
    box.innerHTML = '';
    if (!events?.length) {
      box.innerHTML = '<div class="empty-hint">暂无 trace 事件（运行会话后生成）</div>';
      return;
    }
    for (const ev of events) {
      const row = document.createElement('div');
      row.className = 'trace-row';
      row.innerHTML = `<span class="trace-kind">${escapeHtml(ev.kind)}</span>
        <span class="trace-ts">${escapeHtml(ev.ts)}</span>
        <span class="trace-payload">${escapeHtml(JSON.stringify(ev.payload ?? {}))}</span>`;
      box.append(row);
    }
  } catch {
    box.innerHTML = '<div class="empty-hint">加载失败</div>';
  }
}

async function loadMailAll() {
  try {
    const { mail } = await api('/api/mailbox/all?limit=200');
    const root = $('#listMailAll');
    root.innerHTML = '';
    if (!mail?.length) {
      root.innerHTML = '<div class="empty-hint">暂无邮件</div>';
      return;
    }
    for (const m of mail) {
      const el = document.createElement('div');
      el.className = 'list-item';
      el.style.cursor = 'default';
      el.innerHTML = `<div class="row"><strong>${escapeHtml(m.fromAgentId)} → ${escapeHtml(m.toAgentId)}</strong>
        ${escapeHtml(m.status)}</div>
        <div class="muted" style="font-size:0.75rem">${escapeHtml(m.createdAt)}</div>
        <pre style="margin:8px 0 0;font-size:0.78rem;white-space:pre-wrap;font-family:var(--mono)">${escapeHtml(m.content.slice(0, 400))}${m.content.length > 400 ? '…' : ''}</pre>`;
      root.append(el);
    }
  } catch {
    $('#listMailAll').innerHTML = '<div class="empty-hint">无法加载邮箱</div>';
  }
}

async function refreshTeamGraph() {
  let mail = [];
  try {
    const r = await api('/api/mailbox/all?limit=200');
    mail = r.mail ?? [];
  } catch {
    return;
  }
  const key = JSON.stringify({ agents: agents.map((a) => a.id), sessions: sessions.map((s) => [s.id, s.agentId, s.mode]), mail: mail.map((m) => [m.fromAgentId, m.toAgentId]) });
  if (key === lastGraphKey) return;
  lastGraphKey = key;

  const svg = $('#teamSvg');
  const ns = 'http://www.w3.org/2000/svg';
  svg.innerHTML = '';
  const defs = document.createElementNS(ns, 'defs');
  defs.innerHTML = `<marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
    <polygon points="0 0, 8 3, 0 6" fill="rgba(200,255,0,0.5)" /></marker>`;
  svg.append(defs);

  const teammateAgents = new Set(sessions.filter((s) => s.mode === 'teammate').map((s) => s.agentId));
  const ids = [...new Set([...agents.map((a) => a.id), ...mail.flatMap((m) => [m.fromAgentId, m.toAgentId])])];
  if (ids.length === 0) {
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', '50%');
    t.setAttribute('y', '50%');
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('fill', '#8b949e');
    t.textContent = '暂无 Agent 数据';
    svg.append(t);
    return;
  }

  const w = svg.clientWidth || 800;
  const h = svg.clientHeight || 380;
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) * 0.32;
  const pos = {};
  ids.forEach((id, i) => {
    const ang = (i / ids.length) * Math.PI * 2 - Math.PI / 2;
    pos[id] = { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) };
  });

  const counts = {};
  for (const m of mail) {
    const k = `${m.fromAgentId}→${m.toAgentId}`;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  for (const [k, n] of Object.entries(counts)) {
    const [from, to] = k.split('→');
    const a = pos[from];
    const b = pos[to];
    if (!a || !b) continue;
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', a.x);
    line.setAttribute('y1', a.y);
    line.setAttribute('x2', b.x);
    line.setAttribute('y2', b.y);
    line.setAttribute('class', `graph-edge${n <= 2 ? ' graph-edge-dim' : ''}`);
    line.setAttribute('stroke-width', String(1.5 + Math.min(n, 6)));
    svg.append(line);
    const midx = (a.x + b.x) / 2;
    const midy = (a.y + b.y) / 2;
    const lbl = document.createElementNS(ns, 'text');
    lbl.setAttribute('x', midx);
    lbl.setAttribute('y', midy - 4);
    lbl.setAttribute('class', 'graph-sublabel');
    lbl.textContent = String(n);
    svg.append(lbl);
  }

  for (const id of ids) {
    const { x, y } = pos[id];
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('class', 'graph-node');
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', x);
    c.setAttribute('cy', y);
    c.setAttribute('r', teammateAgents.has(id) ? 28 : 24);
    c.setAttribute('class', `graph-node-circle${teammateAgents.has(id) ? ' teammate' : ''}`);
    const t1 = document.createElementNS(ns, 'text');
    t1.setAttribute('x', x);
    t1.setAttribute('y', y + 5);
    t1.setAttribute('class', 'graph-label');
    t1.textContent = id.length > 14 ? `${id.slice(0, 12)}…` : id;
    g.append(c, t1);
    svg.append(g);
  }
}

let tickTimer = null;
async function tick() {
  await refreshMeta();
  await loadOverview();
  await refreshPlayPanel();
  const tracePanel = document.getElementById('panel-trace');
  if (tracePanel && !tracePanel.hidden) await loadTrace();
}

$('#autoRefresh').addEventListener('change', () => {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
  if ($('#autoRefresh').checked) {
    tickTimer = setInterval(tick, 2800);
  }
});

window.addEventListener('resize', () => {
  lastGraphKey = '';
  refreshTeamGraph();
});

await tick();
if ($('#autoRefresh').checked) {
  tickTimer = setInterval(tick, 2800);
}
