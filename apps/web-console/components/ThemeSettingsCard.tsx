'use client';

import { useEffect, useState } from 'react';
import { useI18n, type MessageKey } from '@/lib/i18n';
import {
  THEME_CHANGED_EVENT,
  applyThemePreference,
  readThemePreference,
  type ThemePreference
} from '@/lib/theme';
import { SettingsGroup } from './ui';

const OPTIONS: ThemePreference[] = ['light', 'dark', 'system'];

export function ThemeSettingsCard() {
  const { t } = useI18n();
  const [pref, setPref] = useState<ThemePreference>('system');

  useEffect(() => {
    const sync = () => setPref(readThemePreference());
    sync();
    window.addEventListener(THEME_CHANGED_EVENT, sync);
    return () => window.removeEventListener(THEME_CHANGED_EVENT, sync);
  }, []);

  return (
    <div className="card" id="card-theme">
      <SettingsGroup title={t('common.theme')} description={t('settings.theme.desc')}>
        <div className="seg-group" role="radiogroup" aria-label={t('common.theme')}>
          {OPTIONS.map((id) => (
            <label key={id} className={`seg-option${pref === id ? ' is-on' : ''}`}>
              <input
                type="radio"
                name="theme-preference"
                value={id}
                checked={pref === id}
                onChange={() => applyThemePreference(id)}
              />
              <span>{t(`settings.theme.${id}` as MessageKey)}</span>
            </label>
          ))}
        </div>
      </SettingsGroup>
    </div>
  );
}
