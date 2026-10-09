'use client';

import { IngestionSettingsCard } from '../../IngestionSettingsCard';
import { MemoryPanel } from '../../MemoryPanel';
import { SectionFrame } from '../SectionFrame';

export function KnowledgeSection({ active }: { active: boolean }) {
  return (
    <SectionFrame
      section="knowledge"
      active={active}
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
