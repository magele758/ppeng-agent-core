'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import { LanguageToggle } from './LanguageToggle';
import { ThemeToggle } from './ThemeToggle';
import type { AuthMeResponse, AuthProviderId } from '@/lib/auth';
import './auth.css';

function providerHref(id: AuthProviderId): string {
  return `/api/auth/${id}/start`;
}

const ICONS: Record<AuthProviderId, ReactNode> = {
  google: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M22.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h5.9a5.05 5.05 0 0 1-2.19 3.31v2.75h3.54c2.07-1.91 3.25-4.72 3.25-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.54-2.75c-.98.66-2.24 1.05-3.74 1.05-2.88 0-5.31-1.94-6.18-4.55H2.16v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.82 14.09a6.6 6.6 0 0 1 0-4.18V7.07H2.16a11 11 0 0 0 0 9.86l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.36c1.62 0 3.07.56 4.21 1.65l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.16 7.07l3.66 2.84C6.69 7.3 9.12 5.36 12 5.36z" />
    </svg>
  ),
  github: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z" />
    </svg>
  )
};

const ENV_NAMES = [
  'RAW_AGENT_OAUTH_PUBLIC_ORIGIN',
  'RAW_AGENT_OAUTH_GOOGLE_CLIENT_ID',
  'RAW_AGENT_OAUTH_GOOGLE_CLIENT_SECRET',
  'RAW_AGENT_OAUTH_GITHUB_CLIENT_ID',
  'RAW_AGENT_OAUTH_GITHUB_CLIENT_SECRET'
];

export function LoginScreen({
  me,
  error
}: {
  me: AuthMeResponse;
  error?: 'denied' | 'failed';
}) {
  const { t } = useI18n();
  const providers: AuthProviderId[] = ['google', 'github'];
  const available = providers.filter((id) => me.providers.includes(id));
  return (
    <main className="auth-gate">
      <div className="login-card">
        <div className="login-card__top">
          <LanguageToggle />
          <ThemeToggle />
        </div>
        <div className="login-card__brand" aria-hidden="true">
          <span className="login-card__mark">A</span>
        </div>
        <h1 className="login-card__title">{t('auth.title')}</h1>
        <p className="login-card__subtitle">{t('auth.subtitle')}</p>
        {error ? (
          <p className="login-card__error" role="alert">
            {error === 'denied' ? t('auth.errorDenied') : t('auth.errorFailed')}
          </p>
        ) : null}
        {available.length === 0 ? (
          <div className="login-card__setup">
            <strong>{t('auth.noProvider')}</strong>
            <p>{t('auth.noProviderHint')}</p>
            <ul className="login-card__env">
              {ENV_NAMES.map((name) => (
                <li key={name}>
                  <code>{name}</code>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="login-card__actions">
            {available.map((id) => (
              <a key={id} className="btn btn-primary login-card__btn" href={providerHref(id)}>
                {ICONS[id]}
                <span>{id === 'google' ? t('auth.google') : t('auth.github')}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
