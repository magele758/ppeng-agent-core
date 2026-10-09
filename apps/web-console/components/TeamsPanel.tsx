'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { pickSwarmRun, type SwarmPlanRun, type SwarmPlanTask, type TeamGraphWorkType } from '@/lib/team-graph';
import type { MailItem, SessionSummary } from '@/lib/types';
import { EmptyState, SettingsGroup } from './ui';
import { SwarmStartForm, type SwarmRunRow } from './SwarmPanel';
import { TeamGraph, type TeamGraphSnapshot } from './TeamGraph';
import { TeamsDagPanel } from './TeamsDagPanel';
import { TeamTaskList } from './sections/agents/TeamTaskList';

export interface TeamsPanelProps {
  active: boolean;
  sessions: SessionSummary[];
  mailAll: MailItem[];
  swarmRuns: SwarmRunRow[];
  onRefresh: () => void;
}

function runTime(run: SwarmRunRow): string {
  return run.updatedAt ?? run.createdAt ?? '';
}

/** Teams 与 Swarm 合并视图：启动 → 运行列表 → 团队图 + 子任务 → 邮件 / DAG（折叠）。 */
export function TeamsPanel({ active, sessions, mailAll, swarmRuns, onRefresh }: TeamsPanelProps) {
  const { t } = useI18n();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [redraw, setRedraw] = useState(0);
  const [snapshot, setSnapshot] = useState<{
    run: SwarmPlanRun | null;
    tasks: SwarmPlanTask[];
    workTypes: Record<string, TeamGraphWorkType>;
  }>({ run: null, tasks: [], workTypes: {} });

  const runs = useMemo(
    () => [...swarmRuns].sort((a, b) => runTime(b).localeCompare(runTime(a))),
    [swarmRuns]
  );
  const effectiveRunId =
    (selectedRunId && runs.some((r) => r.id === selectedRunId) ? selectedRunId : null) ??
    pickSwarmRun(runs)?.id ??
    null;

  useEffect(() => {
    if (!effectiveRunId) setSnapshot({ run: null, tasks: [], workTypes: {} });
  }, [effectiveRunId]);

  const onSnapshot = useCallback((s: TeamGraphSnapshot) => setSnapshot(s), []);

  const started = useCallback(
    (run: SwarmRunRow) => {
      setSelectedRunId(run.id);
      onRefresh();
    },
    [onRefresh]
  );

  if (!active) return null;

  return (
    <div className="ag-block" id="panel-teams">
      <SwarmStartForm onStarted={started} />

      {runs.length === 0 ? (
        <EmptyState title={t('agents.teams.emptyTitle')} description={t('agents.teams.emptyDesc')} />
      ) : (
        <div className="ag-split ag-split--detail">
          <section className="ag-panel" aria-label={t('agents.teams.graphSectionTitle')}>
            <div className="ag-panel__head">
              <div>
                <h3 className="ag-panel__title">{t('agents.teams.graphSectionTitle')}</h3>
                <p className="ag-panel__lead">{t('teams.graphHint')}</p>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" id="btnTeamsRefresh" onClick={() => setRedraw((n) => n + 1)}>
                {t('teams.redraw')}
              </button>
            </div>
            <TeamGraph
              sessions={sessions}
              redrawToken={redraw}
              active={active}
              runId={effectiveRunId}
              onSnapshot={onSnapshot}
            />
            <div className="ag-block">
              <h4 className="ag-block__title">{t('agents.teams.tasksTitle')}</h4>
              <TeamTaskList tasks={snapshot.tasks} workTypes={snapshot.workTypes} />
            </div>
          </section>
          <section className="ag-panel" aria-label={t('agents.teams.runsTitle')}>
            <div className="ag-panel__head">
              <h3 className="ag-panel__title">{t('agents.teams.runsTitle')}</h3>
              <span className="ag-toolbar__meta">{t('agents.common.count', { count: runs.length })}</span>
            </div>
            <div className="ag-runs" role="group" aria-label={t('agents.teams.runsAria')}>
              {runs.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`ag-run${r.id === effectiveRunId ? ' is-selected' : ''}`}
                  aria-pressed={r.id === effectiveRunId}
                  data-testid={`swarm-run-${r.id}`}
                  onClick={() => setSelectedRunId(r.id)}
                >
                  <span className="ag-run__goal">{r.goal || r.id}</span>
                  <span className="ag-chips">
                    <span className="chip">{r.status}</span>
                    <span className="chip chip-muted">{r.strategy}</span>
                    {r.id === effectiveRunId ? <span className="chip chip-muted">{t('agents.teams.runSelected')}</span> : null}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      <SettingsGroup title={t('teams.mailTitle')} description={t('agents.teams.mailSectionDesc')} collapsible defaultOpen={false}>
        <div className="ag-mail" id="listMailAll">
          {!mailAll.length ? (
            <p className="ag-panel__lead">{t('teams.emptyMail')}</p>
          ) : (
            mailAll.map((m, i) => (
              <div key={i} className="ag-mail__item">
                <strong>
                  {m.fromAgentId} → {m.toAgentId}
                </strong>{' '}
                <span className="chip chip-muted">{m.status}</span>
                <div className="ag-toolbar__meta">{m.createdAt}</div>
                <pre>
                  {m.content.slice(0, 400)}
                  {m.content.length > 400 ? '…' : ''}
                </pre>
              </div>
            ))
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={t('agents.teams.dagSectionTitle')}
        description={t('agents.teams.dagSectionDesc')}
        collapsible
        defaultOpen={false}
      >
        <TeamsDagPanel />
      </SettingsGroup>
    </div>
  );
}
