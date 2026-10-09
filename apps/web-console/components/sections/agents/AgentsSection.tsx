'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { HomePanel } from '../../HomePanel';
import { SkillProposalsCard } from '../../SkillProposalsCard';
import { TeamsPanel } from '../../TeamsPanel';
import { EmptyState } from '../../ui';
import { useLab } from '../../shell/LabProvider';
import { SectionFrame } from '../SectionFrame';

export function AgentsSection({ active }: { active: boolean }) {
  const { t } = useI18n();
  const lab = useLab();
  const [graphRedraw, setGraphRedraw] = useState(0);
  const refresh = () => void lab.tick();

  return (
    <SectionFrame
      section="agents"
      active={active}
      renderSub={(sub) => {
        switch (sub) {
          case 'agents':
            return (
              <HomePanel
                active
                view="agent"
                agents={lab.agents}
                tasks={lab.tasks}
                socialSchedules={lab.socialSchedules}
                jobs={lab.jobs}
                swarmRuns={lab.swarmRuns}
                onRefresh={refresh}
              />
            );
          case 'bots':
            return (
              <>
                {lab.bots.length === 0 ? (
                  <EmptyState
                    title={t('agents.bots.emptyTitle')}
                    description={t('agents.bots.emptyDesc')}
                    action={
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => lab.navigate('chat')}>
                        {t('agents.bots.openInChat')}
                      </button>
                    }
                  />
                ) : (
                  <div className="home-list">
                    {lab.bots.map((b) => (
                      <div key={b.id} className="list-item">
                        <div className="list-item__main">
                          <span className="list-item__title">{b.title || b.name || b.id}</span>
                          <span className="chip chip-muted">{b.agentId}</span>
                        </div>
                      </div>
                    ))}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => lab.navigate('chat')}>
                      {t('agents.bots.openInChat')}
                    </button>
                  </div>
                )}
              </>
            );
          case 'teams':
            return (
              <>
                <TeamsPanel
                  active
                  sessions={lab.sessions}
                  mailAll={lab.mailAll}
                  graphRedraw={graphRedraw}
                  onGraphRedraw={() => setGraphRedraw((n) => n + 1)}
                />
                <HomePanel
                  active
                  view="teams"
                  agents={lab.agents}
                  tasks={lab.tasks}
                  socialSchedules={lab.socialSchedules}
                  jobs={lab.jobs}
                  swarmRuns={lab.swarmRuns}
                  onRefresh={refresh}
                />
              </>
            );
          case 'skills':
            return (
              <>
                <HomePanel
                  active
                  view="skills"
                  agents={lab.agents}
                  tasks={lab.tasks}
                  socialSchedules={lab.socialSchedules}
                  jobs={lab.jobs}
                  swarmRuns={lab.swarmRuns}
                  onRefresh={refresh}
                />
                <SkillProposalsCard />
              </>
            );
          default:
            return null;
        }
      }}
    />
  );
}
