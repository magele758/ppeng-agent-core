'use client';

import type { ArtifactItem } from '@/lib/activity-tools';

export function ArtifactRail({ items }: { items: ArtifactItem[] }) {
  return (
    <div className="artifact-rail" aria-label="工件">
      <div className="activity-panel__head">
        <h3 className="activity-panel__title">Artifacts</h3>
        <span className="badge">{items.length}</span>
      </div>
      <div className="artifact-rail__list">
        {!items.length ? (
          <div className="empty-hint">暂无 surface / 图片工件</div>
        ) : (
          items.map((it) => (
            <div key={it.id} className={`artifact-chip artifact-chip--${it.kind}`}>
              <span className="artifact-chip__kind">{it.kind === 'a2ui' ? 'UI' : 'IMG'}</span>
              <span className="artifact-chip__label" title={it.label}>
                {it.label}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
