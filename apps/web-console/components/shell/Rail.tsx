'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import { SECTION_IDS, formatHash, type SectionId } from '@/lib/nav';
import { SectionIcon } from './icons';
import { useLab } from './LabProvider';

export function Rail({ footer }: { footer?: ReactNode }) {
  const { t } = useI18n();
  const { location, navigate, approvals } = useLab();

  const badgeFor = (id: SectionId): number => (id === 'tasks' ? approvals.length : 0);

  return (
    <aside className="lab-rail" aria-label={t('shell.nav.label')}>
      <div className="lab-rail__brand">
        <span className="brand-mark" aria-hidden="true">
          <svg className="brand-glyph" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 24V8l8 8 8-8v16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="16" cy="16" r="3" fill="currentColor" />
          </svg>
        </span>
        <span>{t('nav.agentHome')}</span>
      </div>
      <nav className="lab-rail__nav" aria-label={t('shell.nav.primary')}>
        {SECTION_IDS.map((id) => {
          const badge = badgeFor(id);
          const current = location.section === id;
          return (
            <a
              key={id}
              id={`nav-${id}`}
              className="lab-rail__link"
              href={formatHash({ section: id, sub: null })}
              aria-current={current ? 'page' : undefined}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                navigate(id);
              }}
            >
              <span className="lab-rail__icon">
                <SectionIcon id={id} />
              </span>
              <span className="lab-rail__label">{t(`shell.nav.${id}`)}</span>
              {badge > 0 ? (
                <span className="lab-rail__badge" aria-label={t('shell.nav.pending', { count: badge })}>
                  {badge}
                </span>
              ) : null}
            </a>
          );
        })}
      </nav>
      {footer ? <div className="lab-rail__foot">{footer}</div> : null}
    </aside>
  );
}
