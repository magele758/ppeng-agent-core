import { SandboxCloudflareSettingsCard, SandboxSettingsCard } from '../../../SandboxSettingsCard';
import type { SettingsEntry } from '../registry';

export const safetyEntries: SettingsEntry[] = [
  {
    id: 'sandbox',
    category: 'safety',
    titleKey: 'settingsEntries.sandbox.title',
    keywordsKey: 'settingsEntries.sandbox.keywords',
    render: () => <SandboxSettingsCard />
  },
  {
    id: 'sandboxCloudflare',
    category: 'safety',
    advanced: true,
    titleKey: 'settingsEntries.sandboxCloudflare.title',
    keywordsKey: 'settingsEntries.sandboxCloudflare.keywords',
    render: () => <SandboxCloudflareSettingsCard />
  }
];
