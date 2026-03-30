/** Agent Lab — full-capability debug console（纯原生 JS，无 Vue/React） */

import { marked } from 'https://esm.sh/marked@15.0.6';
import DOMPurify from 'https://esm.sh/dompurify@3.2.2';

marked.setOptions({ gfm: true, breaks: true });
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 将助手/用户 Markdown 转为安全 HTML（流式与最终渲染共用） */
function renderMarkdown(src) {
  const text = String(src ?? '');
  if (!text.trim()) return '';
  try {
    const html = marked.parse(text, { async: false });
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  } catch {
    return escapeHtml(text);
  }
}

const $ = (sel) => document.querySelector(sel);

let selectedSessionId = null;
let agents = [];
let sessions = [];
let lastGraphKey = '';

/** 距离底部小于此值视为「在底部」，刷新后跟随新消息 */
const SCROLL_BOTTOM_EPS = 72;

function scrollSnapshot(ids) {
  const snap = Object.create(null);
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) snap[id] = { top: el.scrollTop, left: el.scrollLeft };
  }
  return snap;
}

function applyScrollSnapshot(snap) {
  for (const id of Object.keys(snap)) {
    const el = document.getElementById(id);
    if (!el) continue;
    const { top, left } = snap[id];
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    el.scrollTop = Math.min(top, maxTop);
    el.scrollLeft = Math.min(left, maxLeft);
  }
}

function isNearBottom(el) {
  if (!el) return true;
  const { scrollTop, scrollHeight, clientHeight } = el;
  if (scrollHeight <= clientHeight) return true;
  return scrollHeight - scrollTop - clientHeight <= SCROLL_BOTTOM_EPS;
}

const LIST_SCROLL_IDS = [
  'listSessions',
  'sessionListMini',
  'listTasks',
  'listApprovals',
  'listJobs',
  'listWorkspaces',
  'listMailAll'
];

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
  if (name === 'play') {
    void refreshPlayPanel();
  }
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
      if (p.type === 'image') return `[image ${p.assetId}${p.mimeType ? ` ${p.mimeType}` : ''}]`;
      if (p.type === 'tool_call') return `[${p.name}] ${JSON.stringify(p.input ?? {})}`;
      if (p.type === 'tool_result') return `[result ${p.name}] ${p.content ?? ''}`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function messageHasToolParts(parts) {
  return Array.isArray(parts) && parts.some((p) => p.type === 'tool_call' || p.type === 'tool_result');
}

function buildChatTurnShell(role, opts = {}) {
  const { labelOverride } = opts;
  const modClass =
    role === 'user'
      ? 'chat-turn--user'
      : role === 'tool'
        ? 'chat-turn--tool'
        : role === 'system'
          ? 'chat-turn--system'
          : role === 'stream'
            ? 'chat-turn--streaming'
            : 'chat-turn--assistant';
  const wrap = document.createElement('div');
  wrap.className = `chat-turn ${modClass}`;
  const av = document.createElement('div');
  av.className = 'chat-avatar';
  if (role === 'user') av.textContent = '我';
  else if (role === 'tool') av.textContent = 'T';
  else if (role === 'system') av.textContent = 'S';
  else av.textContent = 'AI';

  const content = document.createElement('div');
  content.className = 'chat-turn__content';
  const label = document.createElement('div');
  label.className = 'chat-turn__label';
  label.textContent = labelOverride ?? (role === 'stream' ? 'assistant (streaming)' : role);

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  content.append(label, bubble);
  wrap.append(av, content);
  return { root: wrap, bubble };
}

function createToolCallFold(p) {
  const det = document.createElement('details');
  det.className = 'chat-tool-fold';
  const sum = document.createElement('summary');
  sum.className = 'chat-tool-fold__summary';
  sum.textContent = `调用工具 · ${p.name ?? 'unknown'}`;
  const pre = document.createElement('pre');
  pre.className = 'chat-tool-fold__body';
  try {
    pre.textContent = JSON.stringify(p.input ?? {}, null, 2);
  } catch {
    pre.textContent = String(p.input ?? '');
  }
  det.append(sum, pre);
  return det;
}

function createToolResultFold(p) {
  const det = document.createElement('details');
  det.className = 'chat-tool-fold chat-tool-fold--result';
  const ok = p.ok !== false;
  const sum = document.createElement('summary');
  sum.className = 'chat-tool-fold__summary';
  sum.textContent = ok ? `工具输出 · ${p.name ?? 'unknown'}` : `工具输出 · ${p.name ?? 'unknown'}（失败）`;
  const pre = document.createElement('pre');
  pre.className = 'chat-tool-fold__body';
  pre.textContent = p.content ?? '';
  det.append(sum, pre);
  return det;
}

/** 将一条消息按段渲染：正文 + 可折叠 tool 调用/返回（默认收起） */
function appendStructuredPartsToBubble(bubble, parts, role) {
  const usePreForPlainText = role === 'tool' || role === 'system';
  const textBuf = [];
  const flushText = () => {
    const t = textBuf.join('\n').trim();
    textBuf.length = 0;
    if (!t) return;
    if (usePreForPlainText) {
      const pre = document.createElement('pre');
      pre.className = 'chat-bubble__pre';
      pre.textContent = t;
      bubble.append(pre);
    } else {
      const div = document.createElement('div');
      div.className = 'chat-bubble__body chat-bubble__md';
      div.innerHTML = renderMarkdown(t);
      bubble.append(div);
    }
  };

  for (const p of parts ?? []) {
    if (p.type === 'text') {
      const line = p.text ?? '';
      if (line) textBuf.push(line);
    } else if (p.type === 'image') {
      textBuf.push(`[image ${p.assetId ?? ''}${p.mimeType ? ` ${p.mimeType}` : ''}]`);
    } else if (p.type === 'tool_call') {
      flushText();
      bubble.append(createToolCallFold(p));
    } else if (p.type === 'tool_result') {
      flushText();
      bubble.append(createToolResultFold(p));
    }
  }
  flushText();
}

function buildChatTurnFromParts(m) {
  const r =
    m.role === 'user' || m.role === 'assistant' || m.role === 'tool' || m.role === 'system' ? m.role : 'assistant';
  const { root, bubble } = buildChatTurnShell(r, {});
  appendStructuredPartsToBubble(bubble, m.parts, r);
  if (bubble.children.length === 0 && !bubble.textContent.trim()) {
    const empty = document.createElement('div');
    empty.className = 'chat-bubble__body';
    empty.style.color = 'var(--muted)';
    empty.textContent = '（空消息）';
    bubble.append(empty);
  }
  return { root };
}

function buildChatTurn(role, text, opts = {}) {
  const { root, bubble } = buildChatTurnShell(role, opts);
  const usePre = role === 'tool' || role === 'system';
  let textEl;
  if (usePre) {
    textEl = document.createElement('pre');
    textEl.className = 'chat-bubble__pre';
    textEl.textContent = text;
    bubble.append(textEl);
  } else {
    textEl = document.createElement('div');
    textEl.className = 'chat-bubble__body chat-bubble__md';
    textEl.innerHTML = renderMarkdown(text);
    bubble.append(textEl);
  }
  return { root, textEl };
}

function stripChatEmpty(msgsEl) {
  msgsEl?.querySelector('.chat-empty')?.remove();
}

/** 发送后立刻展示在对话流里的用户气泡文案（与 msgPartsToText 尽量一致） */
function userPreviewText(text, imageAssetIds = []) {
  const ids = imageAssetIds ?? [];
  const parts = [];
  const t = (text ?? '').trim();
  if (t && t !== '(image)') parts.push(t);
  else if (ids.length) parts.push(`（${ids.length} 张图片）`);
  else if (t === '(image)') parts.push('（图片）');
  for (const id of ids) {
    const short = id.length > 14 ? `${id.slice(0, 14)}…` : id;
    parts.push(`[image ${short}]`);
  }
  return parts.filter(Boolean).join('\n') || '…';
}

function appendOptimisticUserTurn(msgsEl, text, imageAssetIds) {
  stripChatEmpty(msgsEl);
  msgsEl.append(buildChatTurn('user', userPreviewText(text, imageAssetIds)).root);
}

/** 底部「正在回复」流式气泡：主正文 + 可选 reasoning 区 */
function appendAssistantStreamingRow(msgsEl) {
  const { root, textEl } = buildChatTurn('stream', '…');
  const bubble = root.querySelector('.chat-bubble');
  const thinkingPre = document.createElement('pre');
  thinkingPre.className = 'chat-bubble__thinking';
  thinkingPre.hidden = true;
  bubble.insertBefore(thinkingPre, textEl);
  msgsEl.append(root);
  const scroll = () => {
    msgsEl.scrollTop = msgs.scrollHeight;
  };
  return { root, textEl, thinkingPre, scroll };
}

/**
 * 累加 SSE 帧并解析 event/data 块。
 * @param {(event: string, payload: unknown) => void} onEvent
 */
function feedSseBuffer(buf, chunk, decoder, onEvent) {
  let next = buf + decoder.decode(chunk, { stream: true });
  const parts = next.split('\n\n');
  const tail = parts.pop() ?? '';
  for (const block of parts) {
    const m = block.match(/^event:\s*(\S+)\ndata:\s*(.+)$/ms);
    if (!m) continue;
    let payload;
    try {
      payload = JSON.parse(m[2]);
    } catch {
      continue;
    }
    onEvent(m[1], payload);
  }
  return tail;
}

function renderMessages(container, messages, { streamNote } = {}) {
  const stickToBottom = isNearBottom(container);
  const prevTop = container.scrollTop;
  container.innerHTML = '';
  if (streamNote) {
    const { root } = buildChatTurn('system', streamNote, { labelOverride: 'stream' });
    container.append(root);
  }
  if (!messages?.length && !streamNote) {
    container.innerHTML = `<div class="chat-empty">
      <h3 class="chat-empty__title">暂无消息</h3>
      <p class="chat-empty__hint">发送一条消息开始对话</p>
    </div>`;
    return;
  }
  for (const m of messages ?? []) {
    const r = m.role === 'user' || m.role === 'assistant' || m.role === 'tool' || m.role === 'system' ? m.role : 'assistant';
    if (messageHasToolParts(m.parts)) {
      container.append(buildChatTurnFromParts(m).root);
    } else {
      container.append(buildChatTurn(r, msgPartsToText(m.parts)).root);
    }
  }
  if (stickToBottom) {
    container.scrollTop = container.scrollHeight;
  } else {
    const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTop = Math.min(prevTop, maxTop);
  }
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
  const listScroll = scrollSnapshot(LIST_SCROLL_IDS);

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

  applyScrollSnapshot(listScroll);
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
    b1.setAttribute('aria-label', `批准 ${a.toolName}`);
    b1.onclick = async () => {
      await api(`/api/approvals/${a.id}/approve`, { method: 'POST' });
      await tick();
    };
    const b2 = document.createElement('button');
    b2.className = 'btn btn-ghost btn-sm';
    b2.textContent = '拒绝';
    b2.setAttribute('aria-label', `拒绝 ${a.toolName}`);
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
    msgs.innerHTML = `<div class="chat-empty">
      <h3 class="chat-empty__title">选择或创建会话</h3>
      <p class="chat-empty__hint">从左侧选择会话，或在下方输入首条消息以新建</p>
    </div>`;
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

const playInputEl = $('#playInput');
/** @type {string[]} */
let pendingImageAssetIds = [];

function renderPendingImages() {
  const root = $('#pendingImages');
  if (!root) return;
  root.innerHTML = '';
  for (const id of pendingImageAssetIds) {
    const row = document.createElement('span');
    row.className = 'pending-img-row';
    const chip = document.createElement('span');
    chip.className = 'chip chip-muted';
    chip.textContent = `${id.slice(0, 14)}…`;
    chip.title = id;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'btn btn-ghost btn-sm';
    rm.textContent = '×';
    rm.addEventListener('click', () => {
      pendingImageAssetIds = pendingImageAssetIds.filter((x) => x !== id);
      renderPendingImages();
    });
    row.append(chip, rm);
    root.append(row);
  }
}

async function ensurePlaySessionForImages() {
  if (selectedSessionId) return selectedSessionId;
  const agentId = $('#agentSelect').value;
  const data = await api('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'chat',
      title: '新会话',
      agentId,
      autoRun: false,
      background: false
    })
  });
  selectedSessionId = data.session.id;
  await tick();
  return selectedSessionId;
}

function fileToBase64Data(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result || '');
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function ingestFilesFromPicker(fileList) {
  const sid = await ensurePlaySessionForImages();
  for (const file of fileList) {
    const b64 = await fileToBase64Data(file);
    const data = await api(`/api/sessions/${sid}/images/ingest-base64`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataBase64: b64,
        mimeType: file.type || 'image/png'
      })
    });
    pendingImageAssetIds.push(data.asset.id);
  }
  renderPendingImages();
  await refreshPlayPanel();
}

async function ingestUrlFromInput() {
  const urlEl = $('#playImageUrl');
  const url = (urlEl?.value ?? '').trim();
  if (!url) return;
  const sid = await ensurePlaySessionForImages();
  const data = await api(`/api/sessions/${sid}/images/fetch-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });
  pendingImageAssetIds.push(data.asset.id);
  urlEl.value = '';
  renderPendingImages();
  await refreshPlayPanel();
}

function adjustPlayInputHeight() {
  if (!playInputEl) return;
  playInputEl.style.height = 'auto';
  playInputEl.style.height = `${Math.min(playInputEl.scrollHeight, 200)}px`;
}
function clearPlayInput() {
  if (!playInputEl) return;
  playInputEl.value = '';
  adjustPlayInputHeight();
}

async function sendPlayMessage() {
  const text = (playInputEl ?? $('#playInput')).value.trim();
  const imageAssetIds = [...pendingImageAssetIds];
  if (!text && imageAssetIds.length === 0) return;
  const st = $('#playStatus');
  st.textContent = '';
  st.className = 'chat-composer-hint';

  try {
    if (selectedSessionId) {
      const msgs = $('#playMessages');
      if ($('#useStream').checked) {
        await streamSession(selectedSessionId, text, imageAssetIds);
      } else {
        appendOptimisticUserTurn(msgs, text || '(image)', imageAssetIds);
        const { root: waitRow } = buildChatTurn('assistant', '…');
        waitRow.classList.add('chat-turn--typing');
        msgs.append(waitRow);
        msgs.scrollTop = msgs.scrollHeight;
        await api(`/api/sessions/${selectedSessionId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text || '(image)', imageAssetIds })
        });
      }
      clearPlayInput();
      pendingImageAssetIds = [];
      renderPendingImages();
      st.textContent = '已发送';
      st.classList.add('ok');
    } else {
      const mode = $('#modeSelect').value;
      const agentId = $('#agentSelect').value;
      if (mode === 'chat') {
        if ($('#useStream').checked) {
          const msgs = $('#playMessages');
          appendOptimisticUserTurn(msgs, text || '(image)', imageAssetIds);
          const { textEl: pre, thinkingPre, scroll } = appendAssistantStreamingRow(msgs);
          scroll();
          const res = await fetch('/api/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: text || '(image)',
              title: (text || '图片').slice(0, 60),
              agentId,
              imageAssetIds
            })
          });
          let acc = '';
          let reasoningAcc = '';
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf = feedSseBuffer(buf, value, dec, (event, payload) => {
              if (event === 'model' && payload.type === 'text_delta') {
                acc += payload.text ?? '';
                pre.innerHTML = renderMarkdown(acc || '…');
                scroll();
              }
              if (event === 'model' && payload.type === 'reasoning_delta') {
                reasoningAcc += payload.text ?? '';
                thinkingPre.textContent = reasoningAcc;
                thinkingPre.hidden = !reasoningAcc;
                scroll();
              }
              if (event === 'result' && payload.session) selectedSessionId = payload.session.id;
            });
          }
          clearPlayInput();
          pendingImageAssetIds = [];
          renderPendingImages();
          st.textContent = '流式完成';
          st.classList.add('ok');
        } else {
          const data = await api('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: text || '(image)',
              title: (text || '图片').slice(0, 60),
              agentId,
              imageAssetIds
            })
          });
          selectedSessionId = data.session.id;
          clearPlayInput();
          pendingImageAssetIds = [];
          renderPendingImages();
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
            message: text || '(image)',
            imageAssetIds,
            agentId,
            autoRun: true,
            background: true
          })
        });
        selectedSessionId = data.session.id;
        clearPlayInput();
        pendingImageAssetIds = [];
        renderPendingImages();
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

async function streamSession(sessionId, message, imageAssetIds = []) {
  const msgs = $('#playMessages');
  appendOptimisticUserTurn(msgs, message || '(image)', imageAssetIds);
  const { textEl: pre, thinkingPre, scroll } = appendAssistantStreamingRow(msgs);
  scroll();
  const res = await fetch(`/api/sessions/${sessionId}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: message || '(image)', imageAssetIds })
  });
  let acc = '';
  let reasoningAcc = '';
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf = feedSseBuffer(buf, value, dec, (event, payload) => {
      if (event === 'model' && payload.type === 'text_delta') {
        acc += payload.text ?? '';
        pre.innerHTML = renderMarkdown(acc || '…');
        scroll();
      }
      if (event === 'model' && payload.type === 'reasoning_delta') {
        reasoningAcc += payload.text ?? '';
        thinkingPre.textContent = reasoningAcc;
        thinkingPre.hidden = !reasoningAcc;
        scroll();
      }
    });
  }
}

$('#btnSend').addEventListener('click', sendPlayMessage);
$('#playImageFile')?.addEventListener('change', (e) => {
  const files = e.target.files;
  if (files?.length) {
    void ingestFilesFromPicker(files).catch((err) => {
      $('#playStatus').textContent = err instanceof Error ? err.message : String(err);
      $('#playStatus').className = 'chat-composer-hint err';
    });
    e.target.value = '';
  }
});
$('#btnPickImage')?.addEventListener('click', () => $('#playImageFile')?.click());
$('#btnFetchImageUrl')?.addEventListener('click', () => {
  void ingestUrlFromInput().catch((err) => {
    $('#playStatus').textContent = err instanceof Error ? err.message : String(err);
    $('#playStatus').className = 'chat-composer-hint err';
  });
});
playInputEl?.addEventListener('input', adjustPlayInputHeight);
playInputEl?.addEventListener('keydown', (e) => {
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
    $('#playStatus').className = 'chat-composer-hint err';
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

$('#btnRefresh').addEventListener('click', () => tick({ includePlayPanel: true }));

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
  const traceScroll = scrollSnapshot(['traceTimeline']);
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
  applyScrollSnapshot(traceScroll);
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
    <polygon points="0 0, 8 3, 0 6" fill="rgba(34,211,238,0.8)" /></marker>`;
  svg.append(defs);

  const teammateAgents = new Set(sessions.filter((s) => s.mode === 'teammate').map((s) => s.agentId));
  const ids = [...new Set([...agents.map((a) => a.id), ...mail.flatMap((m) => [m.fromAgentId, m.toAgentId])])];
  if (ids.length === 0) {
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', '50%');
    t.setAttribute('y', '50%');
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('fill', '#a1a1aa');
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

/**
 * @param {{ includePlayPanel?: boolean }} [opts]
 * - includePlayPanel：是否重拉对话区（手动刷新、发送消息等应为 true；定时轮询应为 false，避免整页重绘跳动）
 */
async function tick(opts = {}) {
  const includePlayPanel = opts.includePlayPanel !== false;
  await refreshMeta();
  await loadOverview();
  if (includePlayPanel) await refreshPlayPanel();
  const tracePanel = document.getElementById('panel-trace');
  if (tracePanel && !tracePanel.hidden) await loadTrace();
}

$('#autoRefresh').addEventListener('change', () => {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
  if ($('#autoRefresh').checked) {
    tickTimer = setInterval(() => tick({ includePlayPanel: false }), 2800);
  }
});

window.addEventListener('resize', () => {
  lastGraphKey = '';
  refreshTeamGraph();
});

await tick();
if ($('#autoRefresh').checked) {
  tickTimer = setInterval(() => tick({ includePlayPanel: false }), 2800);
}
