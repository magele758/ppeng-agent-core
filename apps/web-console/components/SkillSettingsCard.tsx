'use client';

import { useI18n, type MessageKey } from '@/lib/i18n';
import { SettingsGroup } from './ui';
import { LoadGate, SelectField, SourceBadge, StatusLine } from './sections/settings/categories/kit/fields';
import { useSettingsResource } from './sections/settings/categories/kit/settings-store';

export type SkillDisclosureMode = 'shortlist' | 'lazy' | 'full';

interface SkillSettings {
  disclosureMode: SkillDisclosureMode;
}

interface SkillEffective {
  disclosureMode: SkillDisclosureMode;
  source: string;
}

const MODES: readonly SkillDisclosureMode[] = ['shortlist', 'lazy', 'full'];
const DEFAULT_MODE: SkillDisclosureMode = 'shortlist';

export function SkillSettingsCard() {
  const { t } = useI18n();
  const r = useSettingsResource<SkillSettings, SkillEffective>('/api/skills/settings');
  const base = 'settingsEntries.skills';
  const label = (path: string) => t(`${base}.${path}` as MessageKey);
  const mode = r.effective?.disclosureMode ?? r.settings?.disclosureMode ?? DEFAULT_MODE;
  const options = MODES.map((v) => ({ value: v, label: label(`options.disclosure.${v}.label`) }));

  return (
    <SettingsGroup id="card-skill-disclosure" title={label('title')} description={label('desc')}>
      <LoadGate ready={r.settings !== null} error={r.loadError} onRetry={() => void r.reload()}>
        <SelectField
          id="field-skillDisclosure"
          label={label('fields.disclosure.label')}
          hint={`${label('fields.disclosure.hint')} ${label(`options.disclosure.${mode}.desc`)}`}
          value={mode}
          options={options}
          disabled={r.busy}
          defaultText={label(`options.disclosure.${DEFAULT_MODE}.label`)}
          isDefault={mode === DEFAULT_MODE}
          onRestore={() => void r.save({ disclosureMode: DEFAULT_MODE })}
          onChange={(disclosureMode) => void r.save({ disclosureMode })}
        />
        <StatusLine status={r.status} />
        {r.effective ? <SourceBadge source={r.effective.source} /> : null}
      </LoadGate>
    </SettingsGroup>
  );
}
