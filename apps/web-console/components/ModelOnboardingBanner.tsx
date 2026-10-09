'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useLab } from './shell/LabProvider';
import { useModelCatalog } from './useModelCatalog';

const DISMISS_KEY = 'lab.onboarding.model.dismissed';

/** 首次引导：只有内置演示模型（或没有任何模型）时提示去「设置 → 模型」配置真实服务商。 */
export function ModelOnboardingBanner({ hideCta }: { hideCta?: boolean }) {
  const { t } = useI18n();
  const { navigate } = useLab();
  const { setup } = useModelCatalog();
  const [dismissed, setDismissed] = useState(
    () => typeof window !== 'undefined' && window.sessionStorage.getItem(DISMISS_KEY) === '1'
  );

  if (!setup || setup === 'ready' || dismissed) return null;

  return (
    <aside className="onboarding-banner" id="model-onboarding" aria-label={t('settings.onboarding.title')}>
      <div className="onboarding-banner__text">
        <strong>{t('settings.onboarding.title')}</strong>
        <p>{setup === 'demo' ? t('settings.onboarding.descDemo') : t('settings.onboarding.descNone')}</p>
      </div>
      <div className="onboarding-banner__actions">
        {hideCta ? null : (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('settings', 'models')}>
            {t('settings.onboarding.cta')}
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            window.sessionStorage.setItem(DISMISS_KEY, '1');
            setDismissed(true);
          }}
        >
          {t('settings.onboarding.dismiss')}
        </button>
      </div>
    </aside>
  );
}
