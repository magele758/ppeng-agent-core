'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';

export function HelpTip({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <span className="help-tip">
      <button type="button" className="help-tip__btn" aria-label={t('more.help')}>
        ?
      </button>
      <span className="help-tip__bubble" role="tooltip">
        {text}
      </span>
    </span>
  );
}

export function FieldLabel({ children, tip }: { children: ReactNode; tip?: string }) {
  return (
    <span className="field-label">
      {children}
      {tip ? <HelpTip text={tip} /> : null}
    </span>
  );
}

export function ConfigGroup({
  title,
  tip,
  children
}: {
  title: string;
  tip: string;
  children: ReactNode;
}) {
  return (
    <section className="composer-config-group" aria-label={title}>
      <header className="composer-config-group__head">
        <h4 className="composer-config-group__title">{title}</h4>
        <HelpTip text={tip} />
      </header>
      <div className="composer-config-group__body">{children}</div>
    </section>
  );
}
