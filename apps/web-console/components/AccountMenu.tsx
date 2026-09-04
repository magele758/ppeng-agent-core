'use client';

import { useI18n } from '@/lib/i18n';
import type { AuthUser } from '@/lib/auth';

export function AccountMenu({ user }: { user: AuthUser }) {
  const { t } = useI18n();
  const label = user.displayName || user.email || user.id;
  return (
    <div className="account-menu">
      {user.avatarUrl ? (
        <img className="account-menu__avatar" src={user.avatarUrl} alt="" />
      ) : (
        <span className="account-menu__initial" aria-hidden="true">
          {label.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="account-menu__name">{t('auth.signedInAs', { name: label })}</span>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => {
          void fetch('/api/auth/logout', { method: 'POST' }).finally(() => {
            window.location.assign('/');
          });
        }}
      >
        {t('auth.signOut')}
      </button>
    </div>
  );
}
