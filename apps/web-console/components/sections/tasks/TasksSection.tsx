'use client';

import { HomePanel } from '../../HomePanel';
import { OrchestrationPanel } from '../../OrchestrationPanel';
import { useLab } from '../../shell/LabProvider';
import { SectionFrame } from '../SectionFrame';
import { InboxView } from './InboxView';

export function TasksSection({ active }: { active: boolean }) {
  const lab = useLab();
  const refresh = () => void lab.tick();
  return (
    <SectionFrame
      section="tasks"
      active={active}
      badges={{ inbox: lab.approvals.length }}
      renderSub={(sub) => {
        switch (sub) {
          case 'queue':
            return (
              <HomePanel
                active
                view="automation"
                agents={lab.agents}
                tasks={lab.tasks}
                socialSchedules={lab.socialSchedules}
                jobs={lab.jobs}
                swarmRuns={lab.swarmRuns}
                onRefresh={refresh}
              />
            );
          case 'runs':
            return <OrchestrationPanel runs={lab.orchestrationRuns} onRefresh={refresh} />;
          case 'inbox':
            return <InboxView />;
          default:
            return null;
        }
      }}
    />
  );
}
