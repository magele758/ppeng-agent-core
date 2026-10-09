'use client';

import { useI18n } from '@/lib/i18n';
import { LanguageToggle } from './LanguageToggle';
import { SettingsGroup } from './ui';

export function LanguageSettingsCard() {
  const { t } = useI18n();

  return (
    <div className="card" id="card-language">
      <SettingsGroup title={t('common.language')} description={t('common.languageHint')}>
        <LanguageToggle />
      </SettingsGroup>
    </div>
  );
}
