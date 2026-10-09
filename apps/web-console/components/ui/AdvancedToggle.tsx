'use client';

import { useI18n } from '@/lib/i18n';
import { useAdvancedMode } from './useAdvancedMode';

export function AdvancedToggle() {
  const { t } = useI18n();
  const [advanced, setAdvanced] = useAdvancedMode();
  return (
    <label className="ui-advanced-toggle toggle toggle--compact" title={t('shell.ui.advancedHint')}>
      <input
        type="checkbox"
        role="switch"
        checked={advanced}
        onChange={(e) => setAdvanced(e.target.checked)}
        data-testid="advanced-toggle"
      />
      <span>{t('shell.ui.advanced')}</span>
    </label>
  );
}
