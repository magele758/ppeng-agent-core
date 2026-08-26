'use client';

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
  return (
    <div className="card" style={{ gridColumn: '1 / -1' }}>
      <div className="card-head">
        <h3>Orchestration</h3>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh}>
          刷新
        </button>
      </div>
      <div className="list-scroll" style={{ maxHeight: '10rem' }}>
        {!runs.length ? (
          <div className="empty-hint">暂无编排 run</div>
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
