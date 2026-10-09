import { EventLogSettingsCard } from '../../../EventLogSettingsCard';
import { JevSettingsCard } from '../../../JevSettingsCard';
import { LangfuseSettingsCard } from '../../../LangfuseSettingsCard';
import type { SettingsEntry } from '../registry';

export const integrationsEntries: SettingsEntry[] = [
  {
    id: 'langfuse',
    category: 'integrations',
    advanced: true,
    titleKey: 'settingsEntries.langfuse.title',
    keywordsKey: 'settingsEntries.langfuse.keywords',
    render: () => <LangfuseSettingsCard />
  },
  {
    id: 'jev',
    category: 'integrations',
    advanced: true,
    titleKey: 'settingsEntries.jev.title',
    keywordsKey: 'settingsEntries.jev.keywords',
    render: () => <JevSettingsCard />
  },
  {
    id: 'eventLog',
    category: 'integrations',
    advanced: true,
    titleKey: 'settingsEntries.eventLog.title',
    keywordsKey: 'settingsEntries.eventLog.keywords',
    render: () => <EventLogSettingsCard />
  }
];
