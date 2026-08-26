'use client';

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

const SECTIONS: { id: HomeSection; label: string; hint: string }[] = [
  { id: 'agent', label: 'Agent', hint: '智能体' },
  { id: 'teams', label: 'Teams', hint: '团队协作' },
  { id: 'skills', label: '技能', hint: 'Skills' },
  { id: 'automation', label: '自动化', hint: '任务与调度' },
  { id: 'memory', label: '记忆', hint: 'Memory' }
];

const SOURCE_LABEL: Record<string, string> = {
  builtin: '内置',
  workspace: '仓库',
  agents: '~/.agents'
};

export function HomePanel({
  active,
  agents,
  tasks,
  socialSchedules,
  jobs,
  swarmRuns,
  onRefresh
}: HomePanelProps) {
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
      setSkillsError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setSkillsLoading(false);
    }
  }, []);

  // 首次切到「技能」时按需加载
  useEffect(() => {
    if (active && section === 'skills' && skills.length === 0 && !skillsLoading && !skillsError) {
      void loadSkills();
    }
  }, [active, section, skills.length, skillsLoading, skillsError, loadSkills]);

  if (!active) return null;

  const agentsSorted = sortAgentsById(agents);

  return (
    <section className="panel home-panel" id="panel-home" role="tabpanel" aria-label="Agent Home">
      <div className="home-layout">
        {/* 左侧二级菜单 */}
        <nav className="home-rail" aria-label="功能导航">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`home-rail__item ${section === s.id ? 'active' : ''}`}
              aria-current={section === s.id}
              onClick={() => setSection(s.id)}
            >
              <span className="home-rail__label">{s.label}</span>
              <span className="home-rail__hint">{s.hint}</span>
            </button>
          ))}
        </nav>

        {/* 右侧内容区 */}
        <div className="home-content">
          {section === 'agent' && (
            <div className="home-view">
              <div className="card-head">
                <h2 className="card-title">Agent · 智能体</h2>
                <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh}>
                  刷新
                </button>
              </div>
              {agentsSorted.length === 0 ? (
                <p className="empty-hint">暂无可用智能体。</p>
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
                <h2 className="card-title">Teams · 团队协作</h2>
                <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh}>
                  刷新
                </button>
              </div>
              {swarmRuns.length === 0 ? (
                <p className="empty-hint">
                  暂无 Teams / Swarm 运行记录。可在「对话」中创建队友或发起协作任务。
                </p>
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
                <h2 className="card-title">技能 · Skills</h2>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadSkills()}>
                  重新加载
                </button>
              </div>
              {skillsLoading ? (
                <p className="empty-hint">加载中…</p>
              ) : skillsError ? (
                <p className="empty-hint meta-quiet--warn">加载失败：{skillsError}</p>
              ) : skills.length === 0 ? (
                <p className="empty-hint">未发现技能。技能来自仓库 skills/ 与 ~/.agents 下的 SKILL.md。</p>
              ) : (
                <div className="home-grid">
                  {skills.map((s) => (
                    <div key={s.id} className="card home-card">
                      <div className="home-card__title">{s.name}</div>
                      <div className="home-card__meta">
                        <span className="chip chip-muted">{SOURCE_LABEL[s.source] ?? s.source}</span>
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
                <h2 className="card-title">自动化 · 任务与调度</h2>
                <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh}>
                  刷新
                </button>
              </div>

              <h3 className="home-subhead">任务队列</h3>
              {tasks.length === 0 ? (
                <p className="empty-hint">暂无任务。</p>
              ) : (
                <div className="home-list">
                  {tasks.map((t, i) => (
                    <div key={`${t.title}-${i}`} className="list-item">
                      <div className="list-item__main">
                        <span className="list-item__title">{t.title}</span>
                        <span className="chip chip-muted">{t.status}</span>
                      </div>
                      {t.ownerAgentId ? <div className="list-item__sub">{t.ownerAgentId}</div> : null}
                    </div>
                  ))}
                </div>
              )}

              <h3 className="home-subhead">定时发布</h3>
              {socialSchedules.length === 0 ? (
                <p className="empty-hint">暂无定时发布计划。</p>
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

              <h3 className="home-subhead">后台任务</h3>
              {jobs.length === 0 ? (
                <p className="empty-hint">暂无后台任务。</p>
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
                <h2 className="card-title">记忆 · Memory</h2>
              </div>
              <MemoryPanel />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
