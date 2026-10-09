import { LanguageSettingsCard } from '../../../LanguageSettingsCard';
import { ThemeSettingsCard } from '../../../ThemeSettingsCard';
import type { SettingsEntry } from '../registry';

export const generalEntries: SettingsEntry[] = [
  {
    id: 'language',
    category: 'general',
    titleKey: 'settings.entries.language.title',
    keywordsKey: 'settings.entries.language.keywords',
    render: () => <LanguageSettingsCard />
  },
  {
    id: 'theme',
    category: 'general',
    titleKey: 'settings.entries.theme.title',
    keywordsKey: 'settings.entries.theme.keywords',
    render: () => <ThemeSettingsCard />
  }
];
