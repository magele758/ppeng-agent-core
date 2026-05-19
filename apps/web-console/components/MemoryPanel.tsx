'use client';

import { api } from '@/lib/api';
import { useCallback, useState } from 'react';

export type MemoryEntryRow = {
  id: string;
  scope: string;
  key: string;
  value: string;
};

export function MemoryPanel() {
  const [scope, setScope] = useState('session.scratch');
  const [rows, setRows] = useState<MemoryEntryRow[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const q = new URLSearchParams({ scope, limit: '50' });
      const res = (await api(`/api/memory?${q}`)) as { entries?: MemoryEntryRow[]; items?: MemoryEntryRow[] };
      setRows(res.entries ?? res.items ?? []);
    } finally {
      setBusy(false);
    }
  }, [scope]);

  return (
    <div className="card card-elevated" style={{ gridColumn: '1 / -1' }}>
      <div className="card-head">
        <h3>Memory</h3>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void load()}>
          查询
        </button>
      </div>
      <div style={{ padding: '0.5rem 0.75rem' }}>
        <select className="input" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="session.scratch">session.scratch</option>
          <option value="session.long">session.long</option>
          <option value="user.memory">user.memory</option>
          <option value="team.memory">team.memory</option>
          <option value="project.memory">project.memory</option>
        </select>
      </div>
      <div className="list-scroll" style={{ maxHeight: '10rem' }}>
        {!rows.length ? (
          <div className="empty-hint">点击查询加载条目</div>
        ) : (
          rows.map((r) => (
            <div key={r.id} className="list-item">
              <div className="row">
                <strong>{r.key}</strong>
                <span className="muted">{r.scope}</span>
              </div>
              <div className="muted" style={{ fontSize: '0.75rem' }}>
                {String(r.value).slice(0, 120)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
