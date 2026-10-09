'use client';

import { useLab } from '../../shell/LabProvider';
import { SectionFrame } from '../SectionFrame';
import { InboxView } from './InboxView';
import { RunsView } from './RunsView';
import { TaskQueueView } from './TaskQueueView';

export function TasksSection({ active }: { active: boolean }) {
  const lab = useLab();
  return (
    <SectionFrame
      section="tasks"
      active={active}
      badges={{ inbox: lab.approvals.length }}
      renderSub={(sub) => {
        switch (sub) {
          case 'queue':
            return <TaskQueueView />;
          case 'runs':
            return <RunsView />;
          case 'inbox':
            return <InboxView />;
          default:
            return null;
        }
      }}
    />
  );
}
