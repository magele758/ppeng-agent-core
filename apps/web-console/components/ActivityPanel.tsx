'use client';

import type { ActivityToolItem } from '@/lib/activity-tools';

function phaseLabel(phase: ActivityToolItem['phase']): string {
  if (phase === 'announce') return '准备';
  if (phase === 'running') return '执行中';
  if (phase === 'error') return '失败';
  return '完成';
}

export function ActivityPanel({
  items,
  emptyHint = '暂无工具活动'
}: {
  items: ActivityToolItem[];
  emptyHint?: string;
}) {
  return (
    <div className="activity-panel" aria-label="运行活动">
      <div className="activity-panel__head">
        <h3 className="activity-panel__title">Activity</h3>
        <span className="badge">{items.length}</span>
      </div>
      <div className="activity-panel__list">
        {!items.length ? (
          <div className="empty-hint">{emptyHint}</div>
        ) : (
          [...items].reverse().map((it) => (
            <details
              key={it.id}
              className={`activity-card activity-card--${it.phase}`}
              open={it.phase === 'running'}
            >
              <summary className="activity-card__summary">
                <span className={`activity-card__phase activity-card__phase--${it.phase}`}>
                  {phaseLabel(it.phase)}
                </span>
                <span className="activity-card__name">{it.name}</span>
              </summary>
              {it.argsPreview ? (
                <pre className="activity-card__pre" aria-label="参数">
                  {it.argsPreview}
                </pre>
              ) : null}
              {it.resultPreview ? (
                <pre
                  className={`activity-card__pre activity-card__pre--result${it.ok === false ? ' is-err' : ''}`}
                  aria-label="结果"
                >
                  {it.resultPreview}
                </pre>
              ) : null}
            </details>
          ))
        )}
      </div>
    </div>
  );
}
