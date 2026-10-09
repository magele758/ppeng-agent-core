import { AgentLoopSettingsCard } from '../../../AgentLoopSettingsCard';
import { CompactSettingsCard } from '../../../CompactSettingsCard';
import { GoalSettingsCard } from '../../../GoalSettingsCard';
import type { SettingsEntry } from '../registry';

export const behaviorEntries: SettingsEntry[] = [
  {
    id: 'agentLoop',
    category: 'behavior',
    titleKey: 'settingsEntries.agentLoop.title',
    keywordsKey: 'settingsEntries.agentLoop.keywords',
    render: () => <AgentLoopSettingsCard />
  },
  {
    id: 'compact',
    category: 'behavior',
    advanced: true,
    titleKey: 'settingsEntries.compact.title',
    keywordsKey: 'settingsEntries.compact.keywords',
    render: () => <CompactSettingsCard />
  },
  {
    id: 'goal',
    category: 'behavior',
    advanced: true,
    titleKey: 'settingsEntries.goal.title',
    keywordsKey: 'settingsEntries.goal.keywords',
    render: () => <GoalSettingsCard />
  }
];
