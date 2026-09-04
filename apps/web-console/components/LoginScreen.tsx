'use client';

import { useI18n } from '@/lib/i18n';
import { LanguageToggle } from './LanguageToggle';
import { ThemeToggle } from './ThemeToggle';
import type { AuthMeResponse, AuthProviderId } from '@/lib/auth';

function providerHref(id: AuthProviderId): string {
  return `/api/auth/${id}/start`;
}

export function LoginScreen({
  me,
  error
}: {
  me: AuthMeResponse;
  error?: 'denied' | 'failed';
}) {
  const { t } = useI18n();
  return (
    <div className="auth-gate">
      <div className="auth-card">
        <div className="auth-card__top">
          <LanguageToggle />
          <ThemeToggle />
        </div>
        <h1 className="auth-card__title">{t('auth.title')}</h1>
        <p className="auth-card__subtitle">{t('auth.subtitle')}</p>
        {error === 'denied' ? <p className="auth-card__error">{t('auth.errorDenied')}</p> : null}
        {error === 'failed' ? <p className="auth-card__error">{t('auth.errorFailed')}</p> : null}
        {me.providers.length === 0 ? (
          <p className="auth-card__hint">{t('auth.noProviderHint')}</p>
        ) : (
          <div className="auth-card__actions">
            {me.providers.includes('google') ? (
              <a className="btn btn-primary auth-card__btn" href={providerHref('google')}>
                {t('auth.google')}
              </a>
            ) : null}
            {me.providers.includes('github') ? (
              <a className="btn btn-primary auth-card__btn" href={providerHref('github')}>
                {t('auth.github')}
              </a>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
