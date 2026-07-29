'use client';

import { api } from '@/lib/api';
import type {
  AgentInfo,
  ApprovalItem,
  MailItem,
  SessionSummary,
  SocialPostScheduleItem,
  TaskSummary
} from '@/lib/types';
import { filterSessionsByQuery } from '@ppeng/agent-core/session-query';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { MorePanel } from './MorePanel';
import { HomePanel } from './HomePanel';
import { OpsPanel } from './OpsPanel';
import type { SwarmRunRow } from './SwarmPanel';
import type { OrchestrationRunRow } from './OrchestrationPanel';
import { GlobalStatusBar } from './GlobalStatusBar';
import { PlayPanel } from './PlayPanel';
import { TeamsPanel } from './TeamsPanel';
import { TracePanel } from './TracePanel';
import { ThemeToggle } from './ThemeToggle';
import { usePlayChat } from './usePlayChat';

const LIST_SCROLL_IDS = [
  'listSessions',
  'sessionListMini',
  'listTasks',
  'listSocialSchedules',
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

type WorkbenchId = 'home' | 'ops' | 'teams' | 'trace' | 'more';

export function AgentLabApp() {
  const [workbench, setWorkbench] = useState<WorkbenchId | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [socialSchedules, setSocialSchedules] = useState<SocialPostScheduleItem[]>([]);
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
  const [sessionSidebarFilter, setSessionSidebarFilter] = useState('');
  const [swarmRuns, setSwarmRuns] = useState<SwarmRunRow[]>([]);
  const [orchestrationRuns, setOrchestrationRuns] = useState<OrchestrationRunRow[]>([]);
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

  const sessionsRef = useRef<SessionSummary[]>([]);
  const agentsRef = useRef<AgentInfo[]>([]);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);
  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  const sidebarSessions = useMemo(
    () => filterSessionsByQuery(sessions, sessionSidebarFilter),
    [sessions, sessionSidebarFilter]
  );

  /** Play/Ops 侧栏：筛选时若当前选中会话被筛掉，仍置顶展示以便高亮可见 */
  const playOpsSidebarSessions = useMemo(() => {
    const q = sessionSidebarFilter.trim();
    if (!q || !selectedSessionId) return sidebarSessions;
    if (sidebarSessions.some((s) => s.id === selectedSessionId)) return sidebarSessions;
    const cur = sessions.find((s) => s.id === selectedSessionId);
    if (!cur) return sidebarSessions;
    return [cur, ...sidebarSessions];
  }, [sessions, sidebarSessions, selectedSessionId, sessionSidebarFilter]);

  const loadOverview = useCallback(async () => {
    const listScroll = scrollSnapshot(LIST_SCROLL_IDS);
    const sidNow = selectedSessionRef.current;
    const [sess, tasksRes, socialRes, appr, ag, ws, jobsRes, swarmRes, orchRes] = await Promise.all([
      api('/api/sessions').catch(() => ({ sessions: undefined })),
      api('/api/tasks').catch(() => ({ tasks: [] as TaskSummary[] })),
      api('/api/social-post-schedules').catch(() => ({ items: [] as SocialPostScheduleItem[] })),
      api('/api/approvals').catch(() => ({ approvals: [] as ApprovalItem[] })),
      api('/api/agents').catch(() => ({ agents: undefined })),
      api('/api/workspaces').catch(() => ({ workspaces: [] as { name?: string; mode?: string }[] })),
      api('/api/background-jobs').catch(() => ({ jobs: [] as { command?: string; status?: string }[] })),
      api('/api/swarm/runs').catch(() => ({ runs: [] as SwarmRunRow[] })),
      api('/api/orchestration/runs').catch(() => ({ runs: [] as OrchestrationRunRow[] }))
    ]);
    const sessFetched = (sess as { sessions?: SessionSummary[] }).sessions;
    const agFetched = (ag as { agents?: AgentInfo[] }).agents;
    // 拉取失败（undefined）时保留现有列表，避免瞬时错误清空会话/Agent
    const sList = sessFetched ?? sessionsRef.current;
    const aList = agFetched ?? agentsRef.current;
    if (sessFetched) setSessions(sessFetched);
    if (agFetched) setAgents(agFetched);
    setTasks((tasksRes as { tasks?: TaskSummary[] }).tasks ?? []);
    setSocialSchedules((socialRes as { items?: SocialPostScheduleItem[] }).items ?? []);
    setApprovals((appr as { approvals?: ApprovalItem[] }).approvals ?? []);
    setJobs((jobsRes as { jobs?: { command?: string; status?: string }[] }).jobs ?? []);
    setWorkspaces((ws as { workspaces?: { name?: string; mode?: string }[] }).workspaces ?? []);
    setSwarmRuns((swarmRes as { runs?: SwarmRunRow[] }).runs ?? []);
    setOrchestrationRuns((orchRes as { runs?: OrchestrationRunRow[] }).runs ?? []);
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
      if (workbench === 'trace') await loadTrace();
    },
    [refreshMeta, loadOverview, loadTrace, workbench]
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

  const openWorkbench = async (name: WorkbenchId) => {
    setWorkbench(name);
    if (name === 'trace') {
      const sid = selectedSessionId || traceSessionId;
      if (sid) setTraceSessionId(sid);
      // load after state flush: use sid directly
      if (sid) {
        try {
          const { events } = (await api(
            `/api/traces?sessionId=${encodeURIComponent(sid)}&limit=500`
          )) as { events?: { kind: string; ts: string; payload: unknown }[] };
          setTraceRows(events ?? []);
        } catch {
          setTraceRows([]);
        }
      }
    }
  };

  const workbenchNav = (
    <nav className="tabs" role="tablist" aria-label="工作台">
      <div className="tabs-rail">
        {(
          [
            ['home', 'tab-home', '功能'],
            ['ops', 'tab-ops', '会话与任务'],
            ['teams', 'tab-teams', 'Teams'],
            ['trace', 'tab-trace', 'Trace'],
            ['more', 'tab-more', '更多']
          ] as const
        ).map(([id, tid, label]) => (
          <button
            key={id}
            type="button"
            className={`tab ${workbench === id ? 'active' : ''}`}
            id={tid}
            role="tab"
            aria-selected={workbench === id}
            onClick={() => void openWorkbench(id)}
          >
            {label}
          </button>
        ))}
        <button type="button" className="tab tab--close" onClick={() => setWorkbench(null)}>
          关闭
        </button>
      </div>
    </nav>
  );

  return (
    <>
      <a className="skip-link" href="#panel-play">
        跳到主内容
      </a>
      <div className="ambient" aria-hidden="true">
        <div className="ambient-grid" />
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
              <div className="brand-title">Agent Home</div>
            </div>
          </div>
          <div className="topbar-meta" id="serverMeta">
            {serverMeta ? (
              <>
                <span className="meta-quiet">
                  {escapeHtml(serverMeta.name)} v{escapeHtml(serverMeta.version)}
                </span>
                {serverMeta.adapter ? (
                  <span className="meta-quiet">{escapeHtml(serverMeta.adapter)}</span>
                ) : null}
              </>
            ) : (
              <span className="meta-quiet meta-quiet--warn">API 不可用</span>
            )}
            <GlobalStatusBar />
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className={`btn btn-ghost btn-sm${workbench ? ' is-active' : ''}`}
              onClick={() => void openWorkbench(workbench ?? 'ops')}
            >
              工作台
            </button>
            <ThemeToggle />
            <label className="toggle toggle--compact">
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
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void tick({ includePlayPanel: true })}>
              刷新
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void api('/api/scheduler/run', { method: 'POST' }).then(() => tick())}
            >
              调度
            </button>
          </div>
        </header>

        <PlayPanel
          active
          sessions={playOpsSidebarSessions}
          agents={agents}
          approvals={approvals}
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
          onOpenTrace={() => {
            if (selectedSessionId) setTraceSessionId(selectedSessionId);
            void openWorkbench('trace');
          }}
          onApprovalsChanged={() => void tick({ includePlayPanel: true })}
          chat={chat}
          sessionFilter={sessionSidebarFilter}
          onSessionFilterChange={setSessionSidebarFilter}
        />

        {workbench ? (
          <div className="lab-drawer" role="dialog" aria-label="工作台">
            <button
              type="button"
              className="lab-drawer__backdrop"
              aria-label="关闭工作台"
              onClick={() => setWorkbench(null)}
            />
            <div className="lab-drawer__panel">
              {workbenchNav}
              <div className="lab-drawer__body workbench-main workbench-main--solo">
                <HomePanel
                  active={workbench === 'home'}
                  agents={agents}
                  tasks={tasks}
                  socialSchedules={socialSchedules}
                  jobs={jobs}
                  swarmRuns={swarmRuns}
                  onRefresh={() => void tick()}
                />
                <OpsPanel
                  active={workbench === 'ops'}
                  sessions={playOpsSidebarSessions}
                  tasks={tasks}
                  socialSchedules={socialSchedules}
                  selectedSessionId={selectedSessionId}
                  onSelectSession={(id) => void selectSession(id)}
                  onSocialScheduleAction={(taskId, action) =>
                    void api(`/api/social-post-schedules/${encodeURIComponent(taskId)}/action`, {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ action })
                    }).then(() => tick({ includePlayPanel: false }))
                  }
                  swarmRuns={swarmRuns}
                  onSwarmRefresh={() => void loadOverview()}
                />

                <TeamsPanel
                  active={workbench === 'teams'}
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
                    void tick({ includePlayPanel: true }).then(() => setWorkbench(null));
                  }}
                />

                <TracePanel
                  active={workbench === 'trace'}
                  embedded
                  sessions={sessions}
                  traceSessionId={traceSessionId}
                  traceRows={traceRows}
                  onTraceSessionIdChange={setTraceSessionId}
                  onLoadTrace={() => void loadTrace()}
                />

                <MorePanel
                  active={workbench === 'more'}
                  approvals={approvals}
                  jobs={jobs}
                  workspaces={workspaces}
                  agents={agents}
                  onRefresh={() => void tick()}
                  onSwitchToTeams={() => void openWorkbench('teams')}
                  orchestrationRuns={orchestrationRuns}
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
