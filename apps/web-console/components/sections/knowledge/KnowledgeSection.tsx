'use client';

import { IngestionSettingsCard } from '../../IngestionSettingsCard';
import { MemoryPanel } from '../../MemoryPanel';
import { AdvancedToggle } from '../../ui';
import { SectionFrame } from '../SectionFrame';

export function KnowledgeSection({ active }: { active: boolean }) {
  return (
    <SectionFrame
      section="knowledge"
      active={active}
      actions={<AdvancedToggle />}
      renderSub={(sub) => {
        switch (sub) {
          case 'memory':
            return <MemoryPanel />;
          case 'ingestion':
            return <IngestionSettingsCard />;
          default:
            return null;
        }
      }}
    />
  );
}
