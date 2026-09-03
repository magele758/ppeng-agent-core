'use client';

import type { ArtifactItem } from '@/lib/activity-tools';
import { useI18n } from '@/lib/i18n';

export function ArtifactRail({ items }: { items: ArtifactItem[] }) {
  const { t } = useI18n();
  return (
    <div className="artifact-rail" aria-label={t('play.artifact.aria')}>
      <div className="activity-panel__head">
        <h3 className="activity-panel__title">Artifacts</h3>
        <span className="badge">{items.length}</span>
      </div>
      <div className="artifact-rail__list">
        {!items.length ? (
          <div className="empty-hint">{t('play.artifact.empty')}</div>
        ) : (
          items.map((it) => (
            <div key={it.id} className={`artifact-chip artifact-chip--${it.kind}`}>
              <span className="artifact-chip__kind">
                {it.kind === 'a2ui' ? 'UI' : it.kind === 'file' ? 'FILE' : 'IMG'}
              </span>
              {it.downloadHref ? (
                <a className="artifact-chip__label" href={it.downloadHref} title={it.label} download>
                  {it.label}
                </a>
              ) : (
                <span className="artifact-chip__label" title={it.label}>
                  {it.label}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
