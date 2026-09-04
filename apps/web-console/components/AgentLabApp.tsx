'use client';

import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import type {
  AgentInfo,
  ApprovalItem,
  BotInfo,
  MailItem,
  SessionSummary,
  SocialPostScheduleItem,
  TaskSummary
} from '@/lib/types';
import {
  botForCanonicalSession,
  filterSessionsByPlaySurface,
  readStoredPlaySurface,
  writeStoredPlaySurface,
  type PlaySurface
} from '@/lib/bots';
import { filterSessionsByQuery } from '@ppeng/api-types';
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
import { ThemeToggle } from './ThemeToggle';
import { LanguageToggle } from './LanguageToggle';
import { AccountMenu } from './AccountMenu';
import { AuthGate } from './AuthGate';
import { ModelSettingsDialog } from './ModelSettingsDialog';
import { usePlayChat } from './usePlayChat';
import type { AuthUser } from '@/lib/auth';

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

type WorkbenchId = 'home' | 'ops' | 'teams' | 'more';

export function AgentLabApp() {
  const { t } = useI18n();
  const [workbench, setWorkbench] = useState<WorkbenchId | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [bots, setBots] = useState<BotInfo[]>([]);
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
  const [traceRows, setTraceRows] = useState<{ kind: string; ts: string; payload: unknown }[]>([]);
  const [graphRedraw, setGraphRedraw] = useState(0);
  const [sessionSidebarFilter, setSessionSidebarFilter] = useState('');
  const [playSurface, setPlaySurfaceState] = useState<PlaySurface>(() => readStoredPlaySurface());
  const [modelSetupOpen, setModelSetupOpen] = useState(false);
  const [swarmRuns, setSwarmRuns] = useState<SwarmRunRow[]>([]);
  const [orchestrationRuns, setOrchestrationRuns] = useState<OrchestrationRunRow[]>([]);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const sessionListStickTopRef = useRef(false);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const selectedSessionRef = useRef<string | null>(null);
  const lastChatSessionRef = useRef<string | null>(null);
  const lastBotSessionRef = useRef<string | null>(null);
  const playSurfaceRef = useRef<PlaySurface>(playSurface);

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
  useEffect(() => {
    playSurfaceRef.current = playSurface;
  }, [playSurface]);

  const sessionsRef = useRef<SessionSummary[]>([]);
  const agentsRef = useRef<AgentInfo[]>([]);
  const botsRef = useRef<BotInfo[]>([]);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);
  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);
  useEffect(() => {
    botsRef.current = bots;
  }, [bots]);

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

  const playSidebarSessions = useMemo(() => {
    const scoped = filterSessionsByPlaySurface(playOpsSidebarSessions, bots, playSurface);
    if (!selectedSessionId) return scoped;
    if (scoped.some((s) => s.id === selectedSessionId)) return scoped;
    const cur = playOpsSidebarSessions.find((s) => s.id === selectedSessionId);
    if (!cur) return scoped;
    if (filterSessionsByPlaySurface([cur], bots, playSurface).length === 0) return scoped;
    return [cur, ...scoped];
  }, [playOpsSidebarSessions, bots, playSurface, selectedSessionId]);

  const loadOverview = useCallback(async () => {
    const listScroll = scrollSnapshot(LIST_SCROLL_IDS);
    const sidNow = selectedSessionRef.current;
    const [sess, tasksRes, socialRes, appr, ag, ws, jobsRes, swarmRes, orchRes, botsRes] = await Promise.all([
      api('/api/sessions').catch(() => ({ sessions: undefined })),
      api('/api/tasks').catch(() => ({ tasks: [] as TaskSummary[] })),
      api('/api/social-post-schedules').catch(() => ({ items: [] as SocialPostScheduleItem[] })),
      api('/api/approvals').catch(() => ({ approvals: [] as ApprovalItem[] })),
      api('/api/agents').catch(() => ({ agents: undefined })),
      api('/api/workspaces').catch(() => ({ workspaces: [] as { name?: string; mode?: string }[] })),
      api('/api/background-jobs').catch(() => ({ jobs: [] as { command?: string; status?: string }[] })),
      api('/api/swarm/runs').catch(() => ({ runs: [] as SwarmRunRow[] })),
      api('/api/orchestration/runs').catch(() => ({ runs: [] as OrchestrationRunRow[] })),
      api('/api/bots').catch(() => ({ bots: undefined }))
    ]);
    const sessFetched = (sess as { sessions?: SessionSummary[] }).sessions;
    const agFetched = (ag as { agents?: AgentInfo[] }).agents;
    const botsFetched = (botsRes as { bots?: BotInfo[] }).bots;
    // 拉取失败（undefined）时保留现有列表，避免瞬时错误清空会话/Agent
    const sList = sessFetched ?? sessionsRef.current;
    if (sessFetched) setSessions(sessFetched);
    if (agFetched) setAgents(agFetched);
    if (botsFetched) setBots(botsFetched);
    setTasks((tasksRes as { tasks?: TaskSummary[] }).tasks ?? []);
    setSocialSchedules((socialRes as { items?: SocialPostScheduleItem[] }).items ?? []);
    setApprovals((appr as { approvals?: ApprovalItem[] }).approvals ?? []);
    setJobs((jobsRes as { jobs?: { command?: string; status?: string }[] }).jobs ?? []);
    setWorkspaces((ws as { workspaces?: { name?: string; mode?: string }[] }).workspaces ?? []);
    setSwarmRuns((swarmRes as { runs?: SwarmRunRow[] }).runs ?? []);
    setOrchestrationRuns((orchRes as { runs?: OrchestrationRunRow[] }).runs ?? []);
    await loadMailAll();

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

  const loadTraceFor = useCallback(async (sid: string | null) => {
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
  }, []);

  useEffect(() => {
    if (workbench !== 'ops') return;
    void loadTraceFor(selectedSessionId);
  }, [workbench, selectedSessionId, loadTraceFor]);

  // usePlayChat needs tick, but tick needs chat.refreshPlayPanel → break cycle with a ref
  const chatRefreshRef = useRef<() => Promise<void>>(async () => {});
  const chatScrollRef = useRef<() => void>(() => {});

  const tick = useCallback(
    async (opts?: { includePlayPanel?: boolean }) => {
      const includePlayPanel = opts?.includePlayPanel !== false;
      await refreshMeta();
      await loadOverview();
      if (includePlayPanel) await chatRefreshRef.current();
      if (workbench === 'ops') await loadTraceFor(selectedSessionRef.current);
    },
    [refreshMeta, loadOverview, loadTraceFor, workbench]
  );

  const upsertBot = useCallback((bot: BotInfo) => {
    setBots((prev) => {
      const i = prev.findIndex((b) => b.id === bot.id);
      if (i < 0) return [...prev, bot];
      const next = [...prev];
      next[i] = bot;
      return next;
    });
  }, []);

  const setPlaySurface = useCallback((next: PlaySurface) => {
    playSurfaceRef.current = next;
    setPlaySurfaceState(next);
    writeStoredPlaySurface(next);
  }, []);

  const chat = usePlayChat({
    selectedSessionId,
    setSelectedSessionId,
    selectedSessionRef,
    sessionListStickTopRef,
    agents,
    bots,
    upsertBot,
    playSurface,
    onPlaySurfaceChange: setPlaySurface,
    tick,
  });

  // Keep refs in sync
  chatRefreshRef.current = chat.refreshPlayPanel;
  chatScrollRef.current = chat.requestScrollPlayToBottom;

  // Sync agentId when agents list changes (Bot 表面锁定 bot.agentId)
  useEffect(() => {
    if (playSurface === 'bot' && chat.botId) {
      const bot = bots.find((b) => b.id === chat.botId);
      if (bot) chat.setAgentId(bot.agentId);
      return;
    }
    const sid = selectedSessionRef.current;
    const sess = sid ? sessionsRef.current.find((s) => s.id === sid) : undefined;
    if (sess?.agentId) {
      chat.setAgentId(sess.agentId);
      return;
    }
    chat.setAgentId((prev: string) => (prev && agents.some((a) => a.id === prev) ? prev : pickDefaultAgentId(agents)));
  }, [agents, bots, chat.botId, playSurface]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const deleteSessions = async (ids: string[]) => {
    const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (!unique.length) return;
    try {
      if (unique.length === 1) {
        await api(`/api/sessions/${encodeURIComponent(unique[0]!)}`, { method: 'DELETE' });
      } else {
        await api('/api/sessions/bulk-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: unique })
        });
      }
      if (selectedSessionRef.current && unique.includes(selectedSessionRef.current)) {
        selectedSessionRef.current = null;
        setSelectedSessionId(null);
      }
      await loadOverview();
      await chat.refreshPlayPanel();
    } catch (e) {
      chat.setPlayStatus({
        text: t('play.sidebar.deleteFailed', {
          detail: e instanceof Error ? e.message : String(e)
        }),
        err: true
      });
      throw e;
    }
  };

  const selectSession = async (id: string) => {
    selectedSessionRef.current = id;
    setSelectedSessionId(id);
    const match = botForCanonicalSession(botsRef.current, id, sessionsRef.current);
    if (match) {
      lastBotSessionRef.current = id;
      setPlaySurface('bot');
      chat.applyBotSelection(match);
    } else {
      lastChatSessionRef.current = id;
      setPlaySurface('chat');
      chat.applyBotSelection(null);
      const sess = sessionsRef.current.find((s) => s.id === id);
      if (sess?.agentId) chat.setAgentId(sess.agentId);
    }
    await loadOverview();
    await chat.refreshPlayPanel();
    chat.requestScrollPlayToBottom();
  };

  const switchPlaySurface = (next: PlaySurface) => {
    if (next === playSurfaceRef.current) return;
    setPlaySurface(next);
    if (next === 'chat') {
      chat.applyBotSelection(null);
      const current = selectedSessionRef.current;
      if (current && botForCanonicalSession(botsRef.current, current, sessionsRef.current)) {
        let fallback = lastChatSessionRef.current;
        if (fallback && !sessionsRef.current.some((s) => s.id === fallback)) {
          fallback = null;
          lastChatSessionRef.current = null;
        }
        selectedSessionRef.current = fallback;
        setSelectedSessionId(fallback);
        const restored = fallback ? sessionsRef.current.find((s) => s.id === fallback) : undefined;
        chat.setAgentId(restored?.agentId || pickDefaultAgentId(agentsRef.current));
        void loadOverview().then(() => chat.refreshPlayPanel());
      } else {
        const curSess = current ? sessionsRef.current.find((s) => s.id === current) : undefined;
        chat.setAgentId(curSess?.agentId || pickDefaultAgentId(agentsRef.current));
      }
      return;
    }
    const current = selectedSessionRef.current;
    if (current && botForCanonicalSession(botsRef.current, current, sessionsRef.current)) return;
    const fallback = lastBotSessionRef.current;
    if (fallback && botForCanonicalSession(botsRef.current, fallback, sessionsRef.current)) {
      void selectSession(fallback);
      return;
    }
    selectedSessionRef.current = null;
    setSelectedSessionId(null);
    void loadOverview().then(() => chat.refreshPlayPanel());
  };

  const openWorkbench = async (name: WorkbenchId) => {
    setWorkbench(name);
    if (name === 'ops') {
      await loadTraceFor(selectedSessionRef.current);
    }
  };

  const workbenchNav = (
    <nav className="tabs" role="tablist" aria-label={t('nav.workbench')}>
      <div className="tabs-rail">
        {(
          [
            ['home', 'tab-home', t('nav.features')],
            ['ops', 'tab-ops', t('nav.trajectory')],
            ['teams', 'tab-teams', t('nav.teams')],
            ['more', 'tab-more', t('nav.more')]
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
          {t('common.close')}
        </button>
      </div>
    </nav>
  );

  return (
    <AuthGate onUser={setAuthUser}>
    <>
      <a className="skip-link" href="#panel-play">
        {t('nav.skipToContent')}
      </a>
      <div className="ambient" aria-hidden="true">
        <div className="ambient-grid" />
      </div>
      <div className="app">
        <PlayPanel
          active
          sessions={playSidebarSessions}
          agents={agents}
          bots={bots}
          playSurface={playSurface}
          onPlaySurfaceChange={switchPlaySurface}
          approvals={approvals}
          selectedSessionId={selectedSessionId}
          onSelectSession={(id) => void selectSession(id)}
          onDeleteSessions={deleteSessions}
          onNewSession={() => {
            chat.applyBotSelection(null);
            selectedSessionRef.current = null;
            setSelectedSessionId(null);
            chat.setAgentId(pickDefaultAgentId(agents));
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
          onOpenTrace={() => void openWorkbench('ops')}
          onApprovalsChanged={() => void tick({ includePlayPanel: true })}
          chat={chat}
          sessionFilter={sessionSidebarFilter}
          onSessionFilterChange={setSessionSidebarFilter}
          onOpenModelSetup={() => setModelSetupOpen(true)}
          onOpenWorkbench={() => void openWorkbench(workbench ?? 'ops')}
          workbenchOpen={Boolean(workbench)}
          accountMenu={authUser ? <AccountMenu user={authUser} /> : null}
        />

        {workbench ? (
          <div className="lab-drawer" role="dialog" aria-label={t('nav.workbench')}>
            <button
              type="button"
              className="lab-drawer__backdrop"
              aria-label={t('nav.closeWorkbench')}
              onClick={() => setWorkbench(null)}
            />
            <div className="lab-drawer__panel">
              <header className="topbar topbar--drawer">
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
                    <div className="brand-title">{t('nav.agentHome')}</div>
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
                    <span className="meta-quiet meta-quiet--warn">{t('nav.apiUnavailable')}</span>
                  )}
                  <GlobalStatusBar />
                </div>
                <div className="topbar-actions">
                  <LanguageToggle />
                  <ThemeToggle />
                  <label className="toggle toggle--compact">
                    <input
                      type="checkbox"
                      checked={autoRefresh}
                      onChange={(e) => setAutoRefresh(e.target.checked)}
                      aria-describedby="autoRefreshHint"
                    />
                    <span>{t('nav.autoRefresh')}</span>
                  </label>
                  <span id="autoRefreshHint" className="sr-only">
                    {t('nav.autoRefreshHint')}
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void tick({ includePlayPanel: true })}>
                    {t('common.refresh')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void api('/api/scheduler/run', { method: 'POST' }).then(() => tick())}
                  >
                    {t('nav.scheduler')}
                  </button>
                  <button
                    type="button"
                    className={`btn btn-ghost btn-sm${modelSetupOpen ? ' is-active' : ''}`}
                    id="btnModelSetup"
                    aria-haspopup="dialog"
                    aria-expanded={modelSetupOpen}
                    onClick={() => setModelSetupOpen(true)}
                  >
                    {t('nav.configureModel')}
                  </button>
                </div>
              </header>
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
                  sessions={sessions}
                  selectedSessionId={selectedSessionId}
                  onSelectSession={(id) => void selectSession(id)}
                  traceRows={traceRows}
                />

                <TeamsPanel
                  active={workbench === 'teams'}
                  sessions={sessions}
                  mailAll={mailAll}
                  graphRedraw={graphRedraw}
                  onGraphRedraw={() => setGraphRedraw((n) => n + 1)}
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
        <ModelSettingsDialog
          open={modelSetupOpen}
          onClose={() => setModelSetupOpen(false)}
          onCatalogChange={chat.applyModelCatalog}
        />
      </div>
    </>
    </AuthGate>
  );
}
