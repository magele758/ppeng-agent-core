'use client';

import { useI18n } from '@/lib/i18n';

export type OrchestrationRunRow = {
  id: string;
  title: string;
  status: string;
  riskLevel?: string;
};

export function OrchestrationPanel({
  runs,
  onRefresh
}: {
  runs: OrchestrationRunRow[];
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="card" style={{ gridColumn: '1 / -1' }}>
      <div className="card-head">
        <h3>{t('ops.orchTitle')}</h3>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh}>
          {t('common.refresh')}
        </button>
      </div>
      <div className="list-scroll" style={{ maxHeight: '10rem' }}>
        {!runs.length ? (
          <div className="empty-hint">{t('ops.emptyOrch')}</div>
        ) : (
          runs.map((r) => (
            <div key={r.id} className="list-item">
              <div className="row">
                <strong>{r.title.slice(0, 48)}</strong>
                <span className="muted">{r.status}</span>
              </div>
              <div className="row muted" style={{ fontSize: '0.75rem' }}>
                {r.riskLevel ?? '—'} · {r.id.slice(0, 10)}…
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
