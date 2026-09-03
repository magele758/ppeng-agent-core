'use client';

import { useI18n } from '@/lib/i18n';
import { LanguageToggle } from './LanguageToggle';

export function LanguageSettingsCard() {
  const { t } = useI18n();

  return (
    <div className="card" id="card-language">
      <div className="card-head">
        <h3>{t('common.language')}</h3>
      </div>
      <p className="muted small">{t('common.languageHint')}</p>
      <LanguageToggle />
    </div>
  );
}
