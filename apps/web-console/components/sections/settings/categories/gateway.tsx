import { GatewaySettingsCard } from '../../../GatewaySettingsCard';
import type { SettingsEntry } from '../registry';

/** 网关 / IM 入站安全设置；登记在集成分类下，条目文件独立于 categories/integrations.tsx。 */
export const gatewayEntries: SettingsEntry[] = [
  {
    id: 'gateway',
    category: 'integrations',
    titleKey: 'settings.entries.gateway.title',
    keywordsKey: 'settings.entries.gateway.keywords',
    render: () => <GatewaySettingsCard />
  }
];
