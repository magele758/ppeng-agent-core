'use client';

import { api } from '@/lib/api';
import { useCallback, useState } from 'react';

export type SwarmRunRow = {
  id: string;
  goal: string;
  status: string;
  strategy: string;
};

export function SwarmPanel({ runs, onRefresh }: { runs: SwarmRunRow[]; onRefresh: () => void }) {
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);

  const createAndStart = useCallback(async () => {
    if (!goal.trim()) return;
    setBusy(true);
    try {
      const created = (await api('/api/swarm/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goal: goal.trim(), strategy: 'pipeline' })
      })) as { run: SwarmRunRow };
      await api(`/api/swarm/runs/${created.run.id}/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tasks: [{ title: 'Implement swarm goal', requiredRole: 'implementer' }]
        })
      });
      setGoal('');
      onRefresh();
    } finally {
      setBusy(false);
    }
  }, [goal, onRefresh]);

  return (
    <div className="card" style={{ gridColumn: '1 / -1' }}>
      <div className="card-head">
        <h3>Swarm</h3>
        <span className="badge">{runs.length}</span>
      </div>
      <div style={{ padding: '0.75rem' }}>
        <div className="row" style={{ gap: '0.5rem', marginBottom: '0.5rem' }}>
          <input
            className="input"
            placeholder="Swarm 目标…"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void createAndStart()}>
            创建并启动
          </button>
        </div>
        <div className="list-scroll" style={{ maxHeight: '12rem' }}>
          {!runs.length ? (
            <div className="empty-hint">暂无 Swarm run</div>
          ) : (
            runs.map((r) => (
              <div key={r.id} className="list-item">
                <div className="row">
                  <strong>{r.goal.slice(0, 60)}</strong>
                  <span className="muted">{r.status}</span>
                </div>
                <div className="row muted" style={{ fontSize: '0.75rem' }}>
                  {r.strategy} · {r.id.slice(0, 10)}…
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
