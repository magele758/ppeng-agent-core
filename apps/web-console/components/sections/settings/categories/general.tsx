import { LanguageSettingsCard } from '../../../LanguageSettingsCard';
import type { SettingsEntry } from '../registry';

export const generalEntries: SettingsEntry[] = [
  {
    id: 'language',
    category: 'general',
    titleKey: 'settings.entries.language.title',
    keywordsKey: 'settings.entries.language.keywords',
    render: () => <LanguageSettingsCard />
  }
];
