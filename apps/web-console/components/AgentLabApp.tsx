'use client';

import { api } from '@/lib/api';
import type {
  AgentInfo,
  ApprovalItem,
  MailItem,
  SessionSummary,
  TaskSummary
} from '@/lib/types';
import {
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';
import { MorePanel } from './MorePanel';
import { OpsPanel } from './OpsPanel';
import { PlayPanel } from './PlayPanel';
import { TeamsPanel } from './TeamsPanel';
import { TracePanel } from './TracePanel';
import { usePlayChat } from './usePlayChat';

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

function pickDefaultAgentId(aList: { id: string }[]): string {
  if (aList.some((a) => a.id === 'general')) return 'general';
  if (aList.some((a) => a.id === 'main')) return 'main';
  return aList[0]?.id ?? '';
}

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
  const [serverMeta, setServerMeta] = useState<{ name: string; version: string; adapter?: string } | null>(
    null
  );
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [traceSessionId, setTraceSessionId] = useState('');
  const [traceRows, setTraceRows] = useState<{ kind: string; ts: string; payload: unknown }[]>([]);
  const [graphRedraw, setGraphRedraw] = useState(0);
  const sessionListStickTopRef = useRef(false);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
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

    applyScrollSnapshot(listScroll);
    if (sessionListStickTopRef.current) {
      if (sidNow && sList[0]?.id === sidNow) {
        for (const id of ['listSessions', 'sessionListMini'] as const) {
          const el = document.getElementById(id);
          if (el) el.scrollTop = 0;
        }
      }
      sessionListStickTopRef.current = false;
    }
  }, [loadMailAll]);

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

  // usePlayChat needs tick, but tick needs chat.refreshPlayPanel → break cycle with a ref
  const chatRefreshRef = useRef<() => Promise<void>>(async () => {});
  const chatScrollRef = useRef<() => void>(() => {});

  const tick = useCallback(
    async (opts?: { includePlayPanel?: boolean }) => {
      const includePlayPanel = opts?.includePlayPanel !== false;
      await refreshMeta();
      await loadOverview();
      if (includePlayPanel) await chatRefreshRef.current();
      if (tab === 'trace') await loadTrace();
    },
    [refreshMeta, loadOverview, loadTrace, tab]
  );

  const chat = usePlayChat({
    selectedSessionId,
    setSelectedSessionId,
    selectedSessionRef,
    sessionListStickTopRef,
    agents,
    tick,
  });

  // Keep refs in sync
  chatRefreshRef.current = chat.refreshPlayPanel;
  chatScrollRef.current = chat.requestScrollPlayToBottom;

  // Sync agentId when agents list changes
  useEffect(() => {
    chat.setAgentId((prev: string) => (prev && agents.some((a) => a.id === prev) ? prev : pickDefaultAgentId(agents)));
  }, [agents]); // eslint-disable-line react-hooks/exhaustive-deps

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
    await chat.refreshPlayPanel();
    chat.requestScrollPlayToBottom();
  };

  const setTabAndRefresh = async (name: TabId) => {
    setTab(name);
    if (name === 'play') {
      await chat.refreshPlayPanel();
      chat.requestScrollPlayToBottom();
    }
    if (name === 'trace') await loadTrace();
  };

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
            <a href="/evolution" className="btn btn-ghost" style={{ fontSize: '0.85rem' }}>
              Evolution 观测
            </a>
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

        <PlayPanel
          active={tab === 'play'}
          sessions={sessions}
          agents={agents}
          selectedSessionId={selectedSessionId}
          onSelectSession={(id) => void selectSession(id)}
          onNewSession={() => {
            selectedSessionRef.current = null;
            setSelectedSessionId(null);
            void loadOverview().then(() => chat.refreshPlayPanel());
          }}
          onRunSession={() =>
            void api(`/api/sessions/${selectedSessionId}/run`, { method: 'POST' }).then(() =>
              tick({ includePlayPanel: true })
            )
          }
          onCancelSession={() =>
            void api(`/api/sessions/${selectedSessionId}/cancel`, { method: 'POST' }).then(() => tick())
          }
          chat={chat}
        />

        <OpsPanel
          active={tab === 'ops'}
          sessions={sessions}
          tasks={tasks}
          selectedSessionId={selectedSessionId}
          onSelectSession={(id) => void selectSession(id)}
        />

        <TeamsPanel
          active={tab === 'teams'}
          agents={agents}
          sessions={sessions}
          mailAll={mailAll}
          graphRedraw={graphRedraw}
          onGraphRedraw={() => setGraphRedraw((n) => n + 1)}
          onTeammateCreated={(tsid) => {
            selectedSessionRef.current = tsid;
            setSelectedSessionId(tsid);
            chat.requestScrollPlayToBottom();
            sessionListStickTopRef.current = true;
            void tick({ includePlayPanel: true }).then(() => setTab('play'));
          }}
        />

        <TracePanel
          active={tab === 'trace'}
          sessions={sessions}
          traceSessionId={traceSessionId}
          traceRows={traceRows}
          onTraceSessionIdChange={setTraceSessionId}
          onLoadTrace={() => void loadTrace()}
        />

        <MorePanel
          active={tab === 'more'}
          approvals={approvals}
          jobs={jobs}
          workspaces={workspaces}
          agents={agents}
          onRefresh={() => void tick()}
          onSwitchToTeams={() => setTab('teams')}
        />
      </div>
    </>
  );
}
