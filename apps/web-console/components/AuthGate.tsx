'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import { authErrorFromSearch, parseAuthMe, type AuthMeResponse, type AuthUser } from '@/lib/auth';
import { LoginScreen } from './LoginScreen';

export function AuthGate({
  children,
  onUser
}: {
  children: ReactNode;
  onUser?: (user: AuthUser | null) => void;
}) {
  const { t } = useI18n();
  const [me, setMe] = useState<AuthMeResponse | null>(null);
  const [error, setError] = useState<'denied' | 'failed' | undefined>();

  useEffect(() => {
    setError(authErrorFromSearch(window.location.search));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/auth/me')
      .then(async (res) => parseAuthMe(await res.json()))
      .then((data) => {
        if (cancelled) return;
        setMe(data);
        onUser?.(data.user);
      })
      .catch(() => {
        if (cancelled) return;
        setMe({ loginRequired: false, providers: [], user: null });
        onUser?.(null);
      });
    return () => {
      cancelled = true;
    };
  }, [onUser]);

  useEffect(() => {
    const onRequired = () => {
      setMe((cur) =>
        cur ? { ...cur, loginRequired: true, user: null } : { loginRequired: true, providers: [], user: null }
      );
      onUser?.(null);
    };
    window.addEventListener('ppeng-login-required', onRequired);
    return () => window.removeEventListener('ppeng-login-required', onRequired);
  }, [onUser]);

  if (!me) {
    return <p className="auth-gate__loading">{t('auth.loading')}</p>;
  }
  if (me.loginRequired && !me.user) {
    return <LoginScreen me={me} error={error} />;
  }
  return <>{children}</>;
}
