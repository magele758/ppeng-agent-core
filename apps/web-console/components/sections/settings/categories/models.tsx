import { ModelFallbackCard } from '../../../ModelFallbackCard';
import { ModelProvidersCard } from '../../../ModelProvidersCard';
import type { SettingsEntry } from '../registry';

export const modelsEntries: SettingsEntry[] = [
  {
    id: 'modelProviders',
    category: 'models',
    titleKey: 'settings.entries.modelProviders.title',
    keywordsKey: 'settings.entries.modelProviders.keywords',
    render: () => <ModelProvidersCard />
  },
  {
    id: 'modelFallback',
    category: 'models',
    advanced: true,
    titleKey: 'settings.entries.modelFallback.title',
    keywordsKey: 'settings.entries.modelFallback.keywords',
    render: () => <ModelFallbackCard />
  }
];
