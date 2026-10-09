'use client';

import type { AgentDetail } from '@/lib/agents-view';
import { SkillProposalsCard } from '../../SkillProposalsCard';
import { TeamsPanel } from '../../TeamsPanel';
import { useLab } from '../../shell/LabProvider';
import { SectionFrame } from '../SectionFrame';
import { AgentsView } from './AgentsView';
import { BotsView } from './BotsView';
import { SkillsView } from './SkillsView';
import './agents.css';

export function AgentsSection({ active }: { active: boolean }) {
  const lab = useLab();
  const refresh = () => void lab.tick();

  return (
    <SectionFrame
      section="agents"
      active={active}
      renderSub={(sub) => {
        switch (sub) {
          case 'agents':
            return <AgentsView agents={lab.agents as AgentDetail[]} onRefresh={refresh} />;
          case 'bots':
            return <BotsView />;
          case 'teams':
            return (
              <TeamsPanel
                active
                sessions={lab.sessions}
                mailAll={lab.mailAll}
                swarmRuns={lab.swarmRuns}
                onRefresh={refresh}
              />
            );
          case 'skills':
            return (
              <>
                <SkillsView />
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
