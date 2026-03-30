'use client';

import { api } from '@/lib/api';
import {
  messageHasToolParts,
  msgPartsToText,
  normalizedRole,
  userPreviewText
} from '@/lib/chat-utils';
import { renderMarkdown } from '@/lib/markdown';
import { feedSseBuffer } from '@/lib/sse';
import type {
  AgentInfo,
  ApprovalItem,
  ChatMessage,
  MailItem,
  SessionSummary,
  TaskSummary
} from '@/lib/types';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react';
import { ChatTurnFromMessage, ChatTurnPlain, ChatTurnStreaming } from './ChatTurns';
import { TeamGraph } from './TeamGraph';

const SCROLL_BOTTOM_EPS = 72;
const LIST_SCROLL_IDS = [
  'listSessions',
  'sessionListMini',
  'listTasks',
  'listApprovals',
  'listJobs',
  'listWorkspaces',
  'listMailAll'
] as const;

function scrollSnapshot(ids: readonly string[]) {
  const snap: Record<string, { top: number; left: number }> = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) snap[id] = { top: el.scrollTop, left: el.scrollLeft };
  }
  return snap;
}

function applyScrollSnapshot(snap: Record<string, { top: number; left: number }>) {
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

function isNearBottom(el: HTMLElement | null) {
  if (!el) return true;
  const { scrollTop, scrollHeight, clientHeight } = el;
  if (scrollHeight <= clientHeight) return true;
  return scrollHeight - scrollTop - clientHeight <= SCROLL_BOTTOM_EPS;
}

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fileToBase64Data(file: File): Promise<string> {
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

type TabId = 'play' | 'ops' | 'teams' | 'trace' | 'more';

export function AgentLabApp() {
  const [tab, setTab] = useState<TabId>('play');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [jobs, setJobs] = useState<{ command?: string; status?: string }[]>([]);
  const [workspaces, setWorkspaces] = useState<{ name?: string; mode?: string }[]>([]);
  const [mailAll, setMailAll] = useState<MailItem[]>([]);
  const [sessionMessages, setSessionMessages] = useState<ChatMessage[]>([]);
  const [playTitle, setPlayTitle] = useState('选择或创建会话');
  const [playMeta, setPlayMeta] = useState('');
  const [serverMeta, setServerMeta] = useState<{ name: string; version: string; adapter?: string } | null>(
    null
  );
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [mode, setMode] = useState<'chat' | 'task'>('chat');
  const [agentId, setAgentId] = useState('');
  const [useStream, setUseStream] = useState(false);
  const [playInput, setPlayInput] = useState('');
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [pendingImageAssetIds, setPendingImageAssetIds] = useState<string[]>([]);
  const [playStatus, setPlayStatus] = useState<{ text: string; ok?: boolean; err?: boolean }>({
    text: ''
  });
  const [traceSessionId, setTraceSessionId] = useState('');
  const [traceRows, setTraceRows] = useState<{ kind: string; ts: string; payload: unknown }[]>([]);
  const [graphRedraw, setGraphRedraw] = useState(0);
  const [mailFrom, setMailFrom] = useState('');
  const [mailTo, setMailTo] = useState('');
  const [mailBody, setMailBody] = useState('');
  const [tmName, setTmName] = useState('');
  const [tmRole, setTmRole] = useState('');
  const [tmPrompt, setTmPrompt] = useState('');
  const [optimisticUser, setOptimisticUser] = useState<string | null>(null);
  const [streamOverlay, setStreamOverlay] = useState<{ text: string; reasoning: string } | null>(null);
  const [waitTyping, setWaitTyping] = useState(false);
  const playMessagesRef = useRef<HTMLDivElement>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 与 selectedSessionId 同步，避免 setState 批处理导致 tick/refresh 读到旧值 */
  const selectedSessionRef = useRef<string | null>(null);

  const refreshMeta = useCallback(async () => {
    try {
      const [ver, health] = await Promise.all([api('/api/version'), api('/api/health')]);
      const v = ver as { name?: string; version?: string };
      const h = health as { adapter?: string };
      setServerMeta({
        name: v.name ?? '—',
        version: v.version ?? '—',
        adapter: h.adapter
      });
    } catch {
      setServerMeta(null);
    }
  }, []);

  const loadMailAll = useCallback(async () => {
    try {
      const r = (await api('/api/mailbox/all?limit=200')) as { mail?: MailItem[] };
      setMailAll(r.mail ?? []);
    } catch {
      setMailAll([]);
    }
  }, []);

  useEffect(() => {
    selectedSessionRef.current = selectedSessionId;
  }, [selectedSessionId]);

  const loadOverview = useCallback(async () => {
    const listScroll = scrollSnapshot(LIST_SCROLL_IDS);
    const sidNow = selectedSessionRef.current;
    const [sess, tasksRes, appr, ag, ws, jobsRes] = await Promise.all([
      api('/api/sessions'),
      api('/api/tasks'),
      api('/api/approvals'),
      api('/api/agents'),
      api('/api/workspaces'),
      api('/api/background-jobs')
    ]);
    const sList = (sess as { sessions?: SessionSummary[] }).sessions ?? [];
    const aList = (ag as { agents?: AgentInfo[] }).agents ?? [];
    setSessions(sList);
    setAgents(aList);
    setTasks((tasksRes as { tasks?: TaskSummary[] }).tasks ?? []);
    setApprovals((appr as { approvals?: ApprovalItem[] }).approvals ?? []);
    setJobs((jobsRes as { jobs?: { command?: string; status?: string }[] }).jobs ?? []);
    setWorkspaces((ws as { workspaces?: { name?: string; mode?: string }[] }).workspaces ?? []);
    await loadMailAll();

    setTraceSessionId((cur) => {
      if (sidNow && sList.some((s) => s.id === sidNow)) {
        return sidNow;
      }
      if (cur && sList.some((s) => s.id === cur)) return cur;
      return sList[0]?.id ?? '';
    });

    setAgentId((prev) => (prev && aList.some((a) => a.id === prev) ? prev : aList[0]?.id ?? ''));

    setMailFrom((f) => (f && aList.some((a) => a.id === f) ? f : aList[0]?.id ?? ''));
    setMailTo((t) => {
      if (t && aList.some((a) => a.id === t)) return t;
      if (aList.length > 1) return aList.find((a) => a.id !== 'main')?.id ?? aList[0]?.id ?? '';
      return aList[0]?.id ?? '';
    });

    applyScrollSnapshot(listScroll);
  }, [loadMailAll]);

  const loadSessionPanel = useCallback(async (sessionId: string | null) => {
    if (!sessionId) {
      setPlayTitle('选择或创建会话');
      setPlayMeta('');
      setSessionMessages([]);
      return;
    }
    try {
      const data = (await api(`/api/sessions/${sessionId}`)) as {
        session: SessionSummary & { agentId?: string; mode?: string; status?: string };
        messages?: ChatMessage[];
      };
      const s = data.session;
      setPlayTitle(s.title);
      setPlayMeta(`${s.mode} · ${s.status} · agent ${s.agentId}`);
      setSessionMessages(data.messages ?? []);
    } catch {
      selectedSessionRef.current = null;
      setSelectedSessionId(null);
    }
  }, []);

  const refreshPlayPanel = useCallback(async () => {
    await loadSessionPanel(selectedSessionRef.current);
  }, [loadSessionPanel]);

  const loadTrace = useCallback(async () => {
    const sid = traceSessionId;
    if (!sid) {
      setTraceRows([]);
      return;
    }
    const traceScroll = scrollSnapshot(['traceTimeline']);
    try {
      const { events } = (await api(
        `/api/traces?sessionId=${encodeURIComponent(sid)}&limit=500`
      )) as { events?: { kind: string; ts: string; payload: unknown }[] };
      setTraceRows(events ?? []);
    } catch {
      setTraceRows([]);
    }
    applyScrollSnapshot(traceScroll);
  }, [traceSessionId]);

  const tick = useCallback(
    async (opts?: { includePlayPanel?: boolean }) => {
      const includePlayPanel = opts?.includePlayPanel !== false;
      await refreshMeta();
      await loadOverview();
      if (includePlayPanel) await refreshPlayPanel();
      if (tab === 'trace') await loadTrace();
    },
    [refreshMeta, loadOverview, refreshPlayPanel, loadTrace, tab]
  );

  useEffect(() => {
    void tick({ includePlayPanel: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- initial load

  useEffect(() => {
    if (tickTimerRef.current) clearInterval(tickTimerRef.current);
    tickTimerRef.current = null;
    if (autoRefresh) {
      tickTimerRef.current = setInterval(() => void tick({ includePlayPanel: false }), 2800);
    }
    return () => {
      if (tickTimerRef.current) clearInterval(tickTimerRef.current);
    };
  }, [autoRefresh, tick]);

  useEffect(() => {
    const onResize = () => setGraphRedraw((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const selectSession = async (id: string) => {
    selectedSessionRef.current = id;
    setSelectedSessionId(id);
    await loadOverview();
    await refreshPlayPanel();
  };

  const setTabAndRefresh = async (name: TabId) => {
    setTab(name);
    if (name === 'play') await refreshPlayPanel();
    if (name === 'trace') await loadTrace();
  };

  const ensurePlaySessionForImages = async (): Promise<string> => {
    if (selectedSessionRef.current) return selectedSessionRef.current;
    const data = (await api('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'chat',
        title: '新会话',
        agentId: agentId || agents[0]?.id,
        autoRun: false,
        background: false
      })
    })) as { session: { id: string } };
    const sid = data.session.id;
    selectedSessionRef.current = sid;
    setSelectedSessionId(sid);
    await tick({ includePlayPanel: true });
    return sid;
  };

  const afterSendCleanup = () => {
    setPlayInput('');
    setPendingImageAssetIds([]);
    setOptimisticUser(null);
    setStreamOverlay(null);
    setWaitTyping(false);
  };

  const scrollPlayToBottom = () => {
    const el = playMessagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const readSseFetch = async (url: string, body: unknown, onSession?: (id: string) => void) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    let acc = '';
    let reasoningAcc = '';
    const reader = res.body?.getReader();
    if (!reader) return;
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf = feedSseBuffer(buf, value, dec, (event, payload) => {
        const p = payload as { type?: string; text?: string; session?: { id: string } };
        if (event === 'model' && p.type === 'text_delta') {
          acc += p.text ?? '';
          setStreamOverlay({
            text: renderMarkdown(acc || '…'),
            reasoning: reasoningAcc
          });
          scrollPlayToBottom();
        }
        if (event === 'model' && p.type === 'reasoning_delta') {
          reasoningAcc += p.text ?? '';
          setStreamOverlay({
            text: renderMarkdown(acc || '…'),
            reasoning: reasoningAcc
          });
          scrollPlayToBottom();
        }
        if (event === 'result' && p.session?.id) {
          const sid = p.session.id;
          onSession?.(sid);
          selectedSessionRef.current = sid;
          setSelectedSessionId(sid);
        }
      });
    }
  };

  const sendPlayMessage = async () => {
    const text = playInput.trim();
    const imageAssetIds = [...pendingImageAssetIds];
    if (!text && imageAssetIds.length === 0) return;
    setPlayStatus({ text: '' });

    try {
      if (selectedSessionId) {
        if (useStream) {
          setOptimisticUser(userPreviewText(text || '(image)', imageAssetIds));
          setStreamOverlay({ text: renderMarkdown('…'), reasoning: '' });
          scrollPlayToBottom();
          await readSseFetch(
            `/api/sessions/${selectedSessionId}/stream`,
            { message: text || '(image)', imageAssetIds },
            undefined
          );
        } else {
          setOptimisticUser(userPreviewText(text || '(image)', imageAssetIds));
          setWaitTyping(true);
          scrollPlayToBottom();
          await api(`/api/sessions/${selectedSessionId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text || '(image)', imageAssetIds })
          });
        }
        afterSendCleanup();
        setPlayStatus({ text: '已发送', ok: true });
      } else if (mode === 'chat') {
        if (useStream) {
          setOptimisticUser(userPreviewText(text || '(image)', imageAssetIds));
          setStreamOverlay({ text: renderMarkdown('…'), reasoning: '' });
          scrollPlayToBottom();
          await readSseFetch('/api/chat/stream', {
            message: text || '(image)',
            title: (text || '图片').slice(0, 60),
            agentId: agentId || agents[0]?.id,
            imageAssetIds
          });
          afterSendCleanup();
          setPlayStatus({ text: '流式完成', ok: true });
        } else {
          const data = (await api('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: text || '(image)',
              title: (text || '图片').slice(0, 60),
              agentId: agentId || agents[0]?.id,
              imageAssetIds
            })
          })) as { session: { id: string } };
          const sid = data.session.id;
          selectedSessionRef.current = sid;
          setSelectedSessionId(sid);
          afterSendCleanup();
          await loadSessionPanel(sid);
          setPlayStatus({ text: '会话已创建', ok: true });
        }
      } else {
        const data = (await api('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'task',
            title: text.slice(0, 80),
            message: text || '(image)',
            imageAssetIds,
            agentId: agentId || agents[0]?.id,
            autoRun: true,
            background: true
          })
        })) as { session: { id: string } };
        const sid = data.session.id;
        selectedSessionRef.current = sid;
        setSelectedSessionId(sid);
        afterSendCleanup();
        await loadSessionPanel(sid);
        setPlayStatus({ text: '任务会话已创建', ok: true });
      }
      await tick({ includePlayPanel: true });
      scrollPlayToBottom();
    } catch (e) {
      setPlayStatus({ text: e instanceof Error ? e.message : String(e), err: true });
      afterSendCleanup();
    }
  };

  const renderPlayMessages = (): ReactNode => {
    if (!selectedSessionId && !optimisticUser && sessionMessages.length === 0 && !streamOverlay && !waitTyping) {
      return (
        <div className="chat-empty">
          <h3 className="chat-empty__title">选择或创建会话</h3>
          <p className="chat-empty__hint">从左侧选择会话，或在下方输入首条消息以新建</p>
        </div>
      );
    }
    if (selectedSessionId && sessionMessages.length === 0 && !optimisticUser && !streamOverlay && !waitTyping) {
      return (
        <div className="chat-empty">
          <h3 className="chat-empty__title">暂无消息</h3>
          <p className="chat-empty__hint">发送一条消息开始对话</p>
        </div>
      );
    }

    const nodes: ReactNode[] = [];
    let k = 0;
    for (const m of sessionMessages) {
      if (messageHasToolParts(m.parts)) {
        nodes.push(<ChatTurnFromMessage key={`m${k++}`} m={m} />);
      } else {
        const r = normalizedRole(m);
        const plain = msgPartsToText(m.parts);
        if (r === 'tool' || r === 'system') {
          nodes.push(<ChatTurnPlain key={`m${k++}`} role={r} text={plain} />);
        } else {
          nodes.push(<ChatTurnFromMessage key={`m${k++}`} m={m} />);
        }
      }
    }
    if (optimisticUser) {
      nodes.push(<ChatTurnPlain key="opt-user" role="user" text={optimisticUser} />);
    }
    if (streamOverlay) {
      nodes.push(
        <ChatTurnStreaming
          key="stream"
          assistantHtml={streamOverlay.text}
          reasoning={streamOverlay.reasoning}
        />
      );
    }
    if (waitTyping) {
      nodes.push(<ChatTurnPlain key="wait" role="assistant" text="…" extraClass="chat-turn--typing" />);
    }
    return <>{nodes}</>;
  };

  useLayoutEffect(() => {
    const el = playMessagesRef.current;
    if (!el) return;
    if (isNearBottom(el)) el.scrollTop = el.scrollHeight;
  }, [sessionMessages]);

  return (
    <>
      <a className="skip-link" href="#panel-play">
        跳到主内容
      </a>
      <div className="ambient" aria-hidden="true">
        <div className="ambient-blob ambient-blob-a" />
        <div className="ambient-blob ambient-blob-b" />
        <div className="ambient-grid" />
        <div className="ambient-noise" />
      </div>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">
              <svg
                className="brand-glyph"
                viewBox="0 0 32 32"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M8 24V8l8 8 8-8v16"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="16" cy="16" r="3" fill="currentColor" />
              </svg>
            </div>
            <div className="brand-copy">
              <div className="brand-kicker">Raw Agent SDK</div>
              <div className="brand-title">Agent Lab</div>
              <div className="brand-sub">全能力调试台 · 会话 / 拓扑 / Trace</div>
            </div>
          </div>
          <div className="topbar-meta" id="serverMeta">
            {serverMeta ? (
              <>
                <span className="chip chip-ok">
                  {escapeHtml(serverMeta.name)} v{escapeHtml(serverMeta.version)}
                </span>
                {serverMeta.adapter ? (
                  <span className="chip chip-muted">{escapeHtml(serverMeta.adapter)}</span>
                ) : null}
              </>
            ) : (
              <span className="chip chip-muted">API 不可用</span>
            )}
          </div>
          <div className="topbar-actions">
            <label className="toggle">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                aria-describedby="autoRefreshHint"
              />
              <span>自动刷新</span>
            </label>
            <span id="autoRefreshHint" className="sr-only">
              定时拉取会话与任务列表
            </span>
            <button type="button" className="btn btn-ghost" onClick={() => void tick({ includePlayPanel: true })}>
              刷新
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void api('/api/scheduler/run', { method: 'POST' }).then(() => tick())}
            >
              运行调度
            </button>
          </div>
        </header>

        <nav className="tabs" role="tablist" aria-label="主功能区">
          <div className="tabs-rail">
            {(
              [
                ['play', 'tab-play', '对话 Playground'],
                ['ops', 'tab-ops', '会话与任务'],
                ['teams', 'tab-teams', 'Teams 拓扑'],
                ['trace', 'tab-trace', 'Trace 时间线'],
                ['more', 'tab-more', '审批 · 作业 · 工作区']
              ] as const
            ).map(([id, tid, label]) => (
              <button
                key={id}
                type="button"
                className={`tab ${tab === id ? 'active' : ''}`}
                id={tid}
                role="tab"
                aria-selected={tab === id}
                onClick={() => void setTabAndRefresh(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </nav>

        <section className={`panel ${tab === 'play' ? 'active' : ''}`} id="panel-play" role="tabpanel">
          <div className="play-layout">
            <aside className="play-sidebar card card-elevated">
              <h3 className="card-title">会话</h3>
              <button
                type="button"
                className="btn btn-secondary btn-block"
                onClick={() => {
                  selectedSessionRef.current = null;
                  setSelectedSessionId(null);
                  void loadOverview().then(() => refreshPlayPanel());
                }}
              >
                新建（清空选择）
              </button>
              <div className="list-scroll" id="sessionListMini">
                {!sessions.length ? (
                  <div className="empty-hint">无会话</div>
                ) : (
                  sessions.map((s) => (
                    <div
                      key={s.id}
                      className={`list-item ${selectedSessionId === s.id ? 'selected' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => void selectSession(s.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void selectSession(s.id);
                      }}
                    >
                      <div className="row">
                        <strong>{s.title}</strong>
                        <span className="pill">{s.mode}</span>
                        <span className={`pill ${s.status === 'waiting_approval' ? 'pill-warn' : s.status === 'completed' ? 'pill-ok' : ''}`}>
                          {s.status}
                        </span>
                      </div>
                      <div className="row muted" style={{ fontSize: '0.75rem' }}>
                        {s.id.slice(0, 12)}…
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="divider" />
              <label className="field">
                <span>模式</span>
                <select value={mode} onChange={(e) => setMode(e.target.value as 'chat' | 'task')}>
                  <option value="chat">Chat</option>
                  <option value="task">Task</option>
                </select>
              </label>
              <label className="field">
                <span>Agent</span>
                <select id="agentSelect" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.id} · {a.role}
                    </option>
                  ))}
                </select>
              </label>
              <label className="toggle field-toggle">
                <input type="checkbox" checked={useStream} onChange={(e) => setUseStream(e.target.checked)} />
                <span>流式输出 (SSE)</span>
              </label>
            </aside>
            <div className="play-main card card-elevated chat-panel">
              <header className="chat-panel-header">
                <div className="chat-panel-header__text">
                  <span className="agent-kicker" aria-hidden="true">
                    Playground · Session
                  </span>
                  <h2 className="chat-panel-title" id="playTitle">
                    {playTitle}
                  </h2>
                  <p className="chat-panel-meta muted" id="playMeta">
                    {playMeta}
                  </p>
                </div>
                <div className="chat-panel-header__actions play-toolbar">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    id="btnRunSession"
                    disabled={!selectedSessionId}
                    onClick={() =>
                      void api(`/api/sessions/${selectedSessionId}/run`, { method: 'POST' }).then(() =>
                        tick({ includePlayPanel: true })
                      )
                    }
                  >
                    Run
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    id="btnCancelSession"
                    disabled={!selectedSessionId}
                    onClick={() =>
                      void api(`/api/sessions/${selectedSessionId}/cancel`, { method: 'POST' }).then(() =>
                        tick()
                      )
                    }
                  >
                    停止
                  </button>
                </div>
              </header>
              <div className="chat-panel-body">
                <div
                  className="chat-feed"
                  id="playMessages"
                  ref={playMessagesRef}
                  role="log"
                  aria-live="polite"
                  aria-relevant="additions"
                >
                  {renderPlayMessages()}
                </div>
                <div className="chat-composer-outer">
                  <label className="sr-only" htmlFor="playInput">
                    消息内容
                  </label>
                  <div className="chat-composer">
                    <textarea
                      id="playInput"
                      className="chat-composer-input"
                      rows={1}
                      placeholder="发消息给 Agent…"
                      autoComplete="off"
                      value={playInput}
                      onChange={(e) => setPlayInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void sendPlayMessage();
                        }
                      }}
                    />
                    <button type="button" className="chat-send-btn" id="btnSend" aria-label="发送" onClick={() => void sendPlayMessage()}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M3.478 2.404a.75.75 0 0 0-.476.784l1.3 7.547a.75.75 0 0 0 .75.615h4.138a.25.25 0 0 1 .158.444l-3.25 2.5a.75.75 0 0 0-.116 1.14l5.9 5.9a.75.75 0 0 0 1.28-.53V4.302a.75.75 0 0 0-1.084-.672l-9.036 3.774z" />
                      </svg>
                    </button>
                  </div>
                  <div className="chat-composer-media">
                    <input
                      type="file"
                      id="playImageFile"
                      className="sr-only"
                      accept="image/*"
                      multiple
                      onChange={(e) => {
                        const files = e.target.files;
                        if (!files?.length) return;
                        void (async () => {
                          try {
                            const sid = await ensurePlaySessionForImages();
                            const ids = [...pendingImageAssetIds];
                            for (const file of files) {
                              const b64 = await fileToBase64Data(file);
                              const data = (await api(`/api/sessions/${sid}/images/ingest-base64`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  dataBase64: b64,
                                  mimeType: file.type || 'image/png'
                                })
                              })) as { asset: { id: string } };
                              ids.push(data.asset.id);
                            }
                            setPendingImageAssetIds(ids);
                            await tick({ includePlayPanel: true });
                          } catch (err) {
                            setPlayStatus({
                              text: err instanceof Error ? err.message : String(err),
                              err: true
                            });
                          }
                        })();
                        e.target.value = '';
                      }}
                    />
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => document.getElementById('playImageFile')?.click()}>
                      本地图片
                    </button>
                    <input
                      type="url"
                      id="playImageUrl"
                      className="chat-image-url"
                      placeholder="图片 URL（服务端下载）"
                      autoComplete="off"
                      value={imageUrlInput}
                      onChange={(e) => setImageUrlInput(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() =>
                        void (async () => {
                          const url = imageUrlInput.trim();
                          if (!url) return;
                          try {
                            const sid = await ensurePlaySessionForImages();
                            const data = (await api(`/api/sessions/${sid}/images/fetch-url`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ url })
                            })) as { asset: { id: string } };
                            setPendingImageAssetIds((x) => [...x, data.asset.id]);
                            setImageUrlInput('');
                            await tick({ includePlayPanel: true });
                          } catch (err) {
                            setPlayStatus({
                              text: err instanceof Error ? err.message : String(err),
                              err: true
                            });
                          }
                        })()
                      }
                    >
                      拉取
                    </button>
                  </div>
                  <div id="pendingImages" className="pending-images" aria-label="待发送图片">
                    {pendingImageAssetIds.map((id) => (
                      <span key={id} className="pending-img-row">
                        <span className="chip chip-muted" title={id}>
                          {id.slice(0, 14)}…
                        </span>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setPendingImageAssetIds((x) => x.filter((y) => y !== id))}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <p
                    id="playStatus"
                    className={`chat-composer-hint${playStatus.ok ? ' ok' : ''}${playStatus.err ? ' err' : ''}`}
                    role="status"
                  >
                    {playStatus.text}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className={`panel ${tab === 'ops' ? 'active' : ''}`} id="panel-ops" role="tabpanel">
          <div className="two-col">
            <div className="card card-elevated">
              <div className="card-head">
                <h3>会话</h3>
                <span className="badge" id="countSessions">
                  {sessions.length}
                </span>
              </div>
              <div className="list-scroll tall" id="listSessions">
                {!sessions.length ? (
                  <div className="empty-hint">无会话</div>
                ) : (
                  sessions.map((s) => (
                    <div
                      key={s.id}
                      className={`list-item ${selectedSessionId === s.id ? 'selected' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => void selectSession(s.id)}
                    >
                      <div className="row">
                        <strong>{s.title}</strong>
                      </div>
                      <div className="row muted" style={{ fontSize: '0.75rem' }}>
                        {s.id.slice(0, 12)}…
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="card card-elevated">
              <div className="card-head">
                <h3>任务</h3>
                <span className="badge" id="countTasks">
                  {tasks.length}
                </span>
              </div>
              <div className="list-scroll tall" id="listTasks">
                {!tasks.length ? (
                  <div className="empty-hint">无任务</div>
                ) : (
                  tasks.map((t, i) => (
                    <div
                      key={i}
                      className="list-item"
                      role={t.sessionId ? 'button' : undefined}
                      tabIndex={t.sessionId ? 0 : undefined}
                      onClick={() => t.sessionId && void selectSession(t.sessionId)}
                    >
                      <div className="row">
                        <strong>{t.title}</strong>
                        {t.status}
                      </div>
                      <div className="row muted" style={{ fontSize: '0.75rem' }}>
                        {t.ownerAgentId ?? '—'}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>

        <section className={`panel ${tab === 'teams' ? 'active' : ''}`} id="panel-teams" role="tabpanel">
          <div className="teams-hero card card-elevated">
            <div>
              <h2>多 Agent 协作拓扑</h2>
              <p className="muted">节点 = 已注册 Agent；边 = 邮箱消息流向（最近 200 条）。Teammate 会话高亮为「后台队友」。</p>
            </div>
            <div className="teams-form">
              <input
                type="text"
                id="tmName"
                placeholder="teammate id，如 reviewer-1"
                autoComplete="off"
                value={tmName}
                onChange={(e) => setTmName(e.target.value)}
              />
              <input
                type="text"
                id="tmRole"
                placeholder="角色描述"
                autoComplete="off"
                value={tmRole}
                onChange={(e) => setTmRole(e.target.value)}
              />
              <textarea
                id="tmPrompt"
                rows={2}
                placeholder="启动提示词"
                value={tmPrompt}
                onChange={(e) => setTmPrompt(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-primary"
                id="btnSpawnTeammate"
                onClick={() =>
                  void (async () => {
                    const name = tmName.trim();
                    const role = tmRole.trim();
                    const prompt = tmPrompt.trim();
                    if (!name || !role || !prompt) return;
                    const data = (await api('/api/teams', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ name, role, prompt, autoRun: true, background: true })
                    })) as { session: { id: string } };
                    const tsid = data.session.id;
                    selectedSessionRef.current = tsid;
                    setSelectedSessionId(tsid);
                    setTmPrompt('');
                    await tick({ includePlayPanel: true });
                    setTab('play');
                  })()
                }
              >
                创建 Teammate
              </button>
            </div>
          </div>
          <div className="card card-elevated teams-board">
            <div className="card-head">
              <h3>拓扑图</h3>
              <button type="button" className="btn btn-ghost btn-sm" id="btnTeamsRefresh" onClick={() => setGraphRedraw((n) => n + 1)}>
                重绘
              </button>
            </div>
            <div className="graph-wrap" id="teamGraph">
              <TeamGraph agents={agents} sessions={sessions} mail={mailAll} redrawToken={graphRedraw} />
            </div>
          </div>
          <div className="card card-elevated">
            <div className="card-head">
              <h3>全局邮箱流</h3>
              <span className="muted">最新优先</span>
            </div>
            <div className="list-scroll tall" id="listMailAll">
              {!mailAll.length ? (
                <div className="empty-hint">暂无邮件</div>
              ) : (
                mailAll.map((m, i) => (
                  <div key={i} className="list-item" style={{ cursor: 'default' }}>
                    <div className="row">
                      <strong>
                        {m.fromAgentId} → {m.toAgentId}
                      </strong>{' '}
                      {m.status}
                    </div>
                    <div className="muted" style={{ fontSize: '0.75rem' }}>
                      {m.createdAt}
                    </div>
                    <pre
                      style={{
                        margin: '8px 0 0',
                        fontSize: '0.78rem',
                        whiteSpace: 'pre-wrap',
                        fontFamily: 'var(--mono)'
                      }}
                    >
                      {m.content.slice(0, 400)}
                      {m.content.length > 400 ? '…' : ''}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className={`panel ${tab === 'trace' ? 'active' : ''}`} id="panel-trace" role="tabpanel">
          <div className="card card-elevated">
            <div className="card-head">
              <h3>Trace 时间线</h3>
              <select
                id="traceSessionSelect"
                className="select-wide"
                aria-label="选择会话以加载 trace"
                value={traceSessionId}
                onChange={(e) => setTraceSessionId(e.target.value)}
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title.slice(0, 36)} ({s.mode})
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-secondary" id="btnLoadTrace" onClick={() => void loadTrace()}>
                加载
              </button>
            </div>
            <p className="muted small">
              来源：<code>stateDir/traces/&lt;sessionId&gt;/events.jsonl</code>
            </p>
            <div className="trace-timeline" id="traceTimeline">
              {!traceRows.length ? (
                <div className="empty-hint">选择会话并点击加载</div>
              ) : (
                traceRows.map((ev, i) => (
                  <div key={i} className="trace-row">
                    <span className="trace-kind">{ev.kind}</span>
                    <span className="trace-ts">{ev.ts}</span>
                    <span className="trace-payload">{JSON.stringify(ev.payload ?? {})}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className={`panel ${tab === 'more' ? 'active' : ''}`} id="panel-more" role="tabpanel">
          <div className="three-col">
            <div className="card card-elevated">
              <div className="card-head">
                <h3>审批</h3>
                <span className="badge" id="countApprovals">
                  {approvals.length}
                </span>
              </div>
              <div className="list-scroll tall" id="listApprovals">
                {!approvals.length ? (
                  <div className="empty-hint">无审批</div>
                ) : (
                  approvals.map((a) => (
                    <div key={a.id} className="list-item">
                      <div className="row">
                        <strong>{a.toolName}</strong>
                      </div>
                      <div className="muted" style={{ fontSize: '0.75rem' }}>
                        {a.sessionId}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          aria-label={`批准 ${a.toolName}`}
                          onClick={() =>
                            void api(`/api/approvals/${a.id}/approve`, { method: 'POST' }).then(() => tick())
                          }
                        >
                          批准
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          aria-label={`拒绝 ${a.toolName}`}
                          onClick={() =>
                            void api(`/api/approvals/${a.id}/reject`, { method: 'POST' }).then(() => tick())
                          }
                        >
                          拒绝
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="card card-elevated">
              <div className="card-head">
                <h3>后台作业</h3>
              </div>
              <div className="list-scroll tall" id="listJobs">
                {!jobs.length ? (
                  <div className="empty-hint">无数据</div>
                ) : (
                  jobs.map((j, i) => (
                    <div key={i} className="list-item" style={{ cursor: 'default' }}>
                      {`${j.command?.slice(0, 40)}… · ${j.status}`}
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="card card-elevated">
              <div className="card-head">
                <h3>工作区</h3>
              </div>
              <div className="list-scroll tall" id="listWorkspaces">
                {!workspaces.length ? (
                  <div className="empty-hint">无数据</div>
                ) : (
                  workspaces.map((w, i) => (
                    <div key={i} className="list-item" style={{ cursor: 'default' }}>
                      {`${w.name} · ${w.mode}`}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          <div className="card card-elevated mail-compose">
            <h3 className="card-title">发邮箱消息</h3>
            <div className="row-3">
              <label className="field">
                <span>From</span>
                <select id="mailFrom" value={mailFrom} onChange={(e) => setMailFrom(e.target.value)}>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>To</span>
                <select id="mailTo" value={mailTo} onChange={(e) => setMailTo(e.target.value)}>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field field-span">
                <span>内容</span>
                <textarea id="mailBody" rows={2} value={mailBody} onChange={(e) => setMailBody(e.target.value)} />
              </label>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              id="btnSendMail"
              onClick={() =>
                void (async () => {
                  const body = mailBody.trim();
                  if (!body) return;
                  await api('/api/mailbox', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      fromAgentId: mailFrom,
                      toAgentId: mailTo,
                      content: body
                    })
                  });
                  await api('/api/scheduler/run', { method: 'POST' });
                  setMailBody('');
                  await tick();
                  setTab('teams');
                })()
              }
            >
              发送并触发调度
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
