'use client';

import { useI18n } from '@/lib/i18n';
import { SettingsGroup } from './ui';
import { LoadGate, StatusLine, ToggleField } from './sections/settings/categories/kit/fields';
import { useSettingsResource } from './sections/settings/categories/kit/settings-store';

interface EventLogSettings {
  enabled: boolean;
}

const DEFAULT_ENABLED = true;

export function EventLogSettingsCard() {
  const { t } = useI18n();
  const r = useSettingsResource<EventLogSettings>('/api/event-log/settings');
  const onOff = (v: boolean) => t(v ? 'settingsEntries.common.on' : 'settingsEntries.common.off');

  return (
    <SettingsGroup id="card-event-log" title={t('settingsEntries.eventLog.title')} description={t('settingsEntries.eventLog.desc')}>
      <LoadGate ready={r.settings !== null} error={r.loadError} onRetry={() => void r.reload()}>
        {r.settings ? (
          <ToggleField
            id="field-eventLogEnabled"
            label={t('settingsEntries.eventLog.fields.enabled.label')}
            hint={t('settingsEntries.eventLog.fields.enabled.hint')}
            checked={r.settings.enabled}
            disabled={r.busy}
            defaultText={onOff(DEFAULT_ENABLED)}
            isDefault={r.settings.enabled === DEFAULT_ENABLED}
            onRestore={() => void r.save({ enabled: DEFAULT_ENABLED })}
            onChange={(enabled) => void r.save({ enabled })}
          />
        ) : null}
        <StatusLine status={r.status} />
      </LoadGate>
    </SettingsGroup>
  );
}
