'use client';

import { useI18n, type I18nContextValue } from '@/lib/i18n';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { AgentInfo, TaskSummary, SocialPostScheduleItem } from '@/lib/types';
import { sortAgentsById } from '@/lib/sort-utils';
import { MemoryPanel } from './MemoryPanel';
import type { SwarmRunRow } from './SwarmPanel';

/** 左侧二级菜单项 */
type HomeSection = 'agent' | 'teams' | 'skills' | 'automation' | 'memory';

interface SkillInfo {
  id: string;
  name: string;
  description: string;
  source: 'builtin' | 'workspace' | 'agents';
  skillPath?: string;
  aliases?: string[];
  triggerWords?: string[];
}

interface Job {
  command?: string;
  status?: string;
}

export interface HomePanelProps {
  active: boolean;
  agents: AgentInfo[];
  tasks: TaskSummary[];
  socialSchedules: SocialPostScheduleItem[];
  jobs: Job[];
  swarmRuns: SwarmRunRow[];
  onRefresh: () => void;
}

const SECTION_IDS: HomeSection[] = ['agent', 'teams', 'skills', 'automation', 'memory'];

function sectionCopy(id: HomeSection, t: I18nContextValue['t']): { label: string; hint: string } {
  switch (id) {
    case 'agent':
      return { label: t('nav.sectionAgent'), hint: t('nav.sectionAgentHint') };
    case 'teams':
      return { label: t('nav.sectionTeams'), hint: t('nav.sectionTeamsHint') };
    case 'skills':
      return { label: t('nav.sectionSkills'), hint: t('nav.sectionSkillsHint') };
    case 'automation':
      return { label: t('nav.sectionAutomation'), hint: t('nav.sectionAutomationHint') };
    case 'memory':
      return { label: t('nav.sectionMemory'), hint: t('nav.sectionMemoryHint') };
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

function sourceLabel(source: SkillInfo['source'], t: I18nContextValue['t']): string {
  switch (source) {
    case 'builtin':
      return t('nav.sourceBuiltin');
    case 'workspace':
      return t('nav.sourceWorkspace');
    case 'agents':
      return t('nav.sourceAgents');
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

export function HomePanel({
  active,
  agents,
  tasks,
  socialSchedules,
  jobs,
  swarmRuns,
  onRefresh
}: HomePanelProps) {
  const { t } = useI18n();
  const [section, setSection] = useState<HomeSection>('agent');
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    setSkillsLoading(true);
    setSkillsError(null);
    try {
      const res = (await api('/api/skills')) as { skills?: SkillInfo[] };
      setSkills(res.skills ?? []);
    } catch (err) {
      setSkillsError(err instanceof Error ? err.message : t('nav.loadFailed'));
    } finally {
      setSkillsLoading(false);
    }
  }, [t]);

  // 首次切到「技能」时按需加载
  useEffect(() => {
    if (active && section === 'skills' && skills.length === 0 && !skillsLoading && !skillsError) {
      void loadSkills();
    }
  }, [active, section, skills.length, skillsLoading, skillsError, loadSkills]);

  if (!active) return null;

  const agentsSorted = sortAgentsById(agents);

  return (
    <section className="panel home-panel" id="panel-home" role="tabpanel" aria-label={t('nav.agentHome')}>
      <div className="home-layout">
        {/* 左侧二级菜单 */}
        <nav className="home-rail" aria-label={t('nav.homeRail')}>
          {SECTION_IDS.map((id) => {
            const copy = sectionCopy(id, t);
            return (
              <button
                key={id}
                type="button"
                className={`home-rail__item ${section === id ? 'active' : ''}`}
                aria-current={section === id}
                onClick={() => setSection(id)}
              >
                <span className="home-rail__label">{copy.label}</span>
                <span className="home-rail__hint">{copy.hint}</span>
              </button>
            );
          })}
        </nav>

        {/* 右侧内容区 */}
        <div className="home-content">
          {section === 'agent' && (
            <div className="home-view">
              <div className="card-head">
                <h2 className="card-title">{t('nav.agentTitle')}</h2>
                <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh}>
                  {t('common.refresh')}
                </button>
              </div>
              {agentsSorted.length === 0 ? (
                <p className="empty-hint">{t('nav.noAgents')}</p>
              ) : (
                <div className="home-grid">
                  {agentsSorted.map((a) => (
                    <div key={a.id} className="card home-card">
                      <div className="home-card__title">{a.name || a.id}</div>
                      <div className="home-card__meta">
                        <span className="chip">{a.role || 'agent'}</span>
                        {a.domainId ? <span className="chip chip-muted">{a.domainId}</span> : null}
                      </div>
                      <div className="home-card__sub">{a.id}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {section === 'teams' && (
            <div className="home-view">
              <div className="card-head">
                <h2 className="card-title">{t('nav.teamsTitle')}</h2>
                <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh}>
                  {t('common.refresh')}
                </button>
              </div>
              {swarmRuns.length === 0 ? (
                <p className="empty-hint">{t('nav.noTeams')}</p>
              ) : (
                <div className="home-list">
                  {swarmRuns.map((r) => (
                    <div key={r.id} className="list-item">
                      <div className="list-item__main">
                        <span className="list-item__title">{r.goal || r.id}</span>
                        <span className="chip chip-muted">{r.status}</span>
                      </div>
                      <div className="list-item__sub">{r.id}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {section === 'skills' && (
            <div className="home-view">
              <div className="card-head">
                <h2 className="card-title">{t('nav.skillsTitle')}</h2>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadSkills()}>
                  {t('nav.reload')}
                </button>
              </div>
              {skillsLoading ? (
                <p className="empty-hint">{t('common.loading')}</p>
              ) : skillsError ? (
                <p className="empty-hint meta-quiet--warn">{t('nav.skillsLoadFailed', { error: skillsError })}</p>
              ) : skills.length === 0 ? (
                <p className="empty-hint">{t('nav.noSkills')}</p>
              ) : (
                <div className="home-grid">
                  {skills.map((s) => (
                    <div key={s.id} className="card home-card">
                      <div className="home-card__title">{s.name}</div>
                      <div className="home-card__meta">
                        <span className="chip chip-muted">{sourceLabel(s.source, t)}</span>
                      </div>
                      <div className="home-card__desc">{s.description}</div>
                      {s.skillPath ? <div className="home-card__sub">{s.skillPath}</div> : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {section === 'automation' && (
            <div className="home-view">
              <div className="card-head">
                <h2 className="card-title">{t('nav.automationTitle')}</h2>
                <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh}>
                  {t('common.refresh')}
                </button>
              </div>

              <h3 className="home-subhead">{t('nav.taskQueue')}</h3>
              {tasks.length === 0 ? (
                <p className="empty-hint">{t('nav.noTasks')}</p>
              ) : (
                <div className="home-list">
                  {tasks.map((task, i) => (
                    <div key={`${task.title}-${i}`} className="list-item">
                      <div className="list-item__main">
                        <span className="list-item__title">{task.title}</span>
                        <span className="chip chip-muted">{task.status}</span>
                      </div>
                      {task.ownerAgentId ? <div className="list-item__sub">{task.ownerAgentId}</div> : null}
                    </div>
                  ))}
                </div>
              )}

              <h3 className="home-subhead">{t('nav.scheduledPosts')}</h3>
              {socialSchedules.length === 0 ? (
                <p className="empty-hint">{t('nav.noSchedules')}</p>
              ) : (
                <div className="home-list">
                  {socialSchedules.map((s) => (
                    <div key={s.taskId} className="list-item">
                      <div className="list-item__main">
                        <span className="list-item__title">{s.title}</span>
                        <span className="chip chip-muted">{s.status}</span>
                      </div>
                      <div className="list-item__sub">
                        {s.publishAt} · {s.channels.join(', ')}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <h3 className="home-subhead">{t('nav.backgroundJobs')}</h3>
              {jobs.length === 0 ? (
                <p className="empty-hint">{t('nav.noJobs')}</p>
              ) : (
                <div className="home-list">
                  {jobs.map((j, i) => (
                    <div key={`${j.command}-${i}`} className="list-item">
                      <div className="list-item__main">
                        <span className="list-item__title">{j.command || '(job)'}</span>
                        <span className="chip chip-muted">{j.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {section === 'memory' && (
            <div className="home-view">
              <div className="card-head">
                <h2 className="card-title">{t('nav.memoryTitle')}</h2>
              </div>
              <MemoryPanel />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
