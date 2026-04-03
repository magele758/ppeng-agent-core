'use client';

import type { SessionSummary, TaskSummary } from '@/lib/types';

export interface OpsPanelProps {
  active: boolean;
  sessions: SessionSummary[];
  tasks: TaskSummary[];
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
}

export function OpsPanel({ active, sessions, tasks, selectedSessionId, onSelectSession }: OpsPanelProps) {
  return (
    <section className={`panel ${active ? 'active' : ''}`} id="panel-ops" role="tabpanel">
      <div className="two-col">
        <div className="card card-elevated">
          <div className="card-head">
            <h3>会话</h3>
            <span className="badge" id="countSessions">
              {sessions.length}
            </span>
          </div>
          <div className="list-scroll tall" id="listSessions">
            {!sessions.length ? (
              <div className="empty-hint">无会话</div>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.id}
                  className={`list-item ${selectedSessionId === s.id ? 'selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectSession(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectSession(s.id);
                    }
                  }}
                >
                  <div className="row">
                    <strong>{s.title}</strong>
                  </div>
                  <div className="row muted" style={{ fontSize: '0.75rem' }}>
                    {s.id.slice(0, 12)}…
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="card card-elevated">
          <div className="card-head">
            <h3>任务</h3>
            <span className="badge" id="countTasks">
              {tasks.length}
            </span>
          </div>
          <div className="list-scroll tall" id="listTasks">
            {!tasks.length ? (
              <div className="empty-hint">无任务</div>
            ) : (
              tasks.map((t, i) => (
                <div
                  key={t.sessionId ?? `task-${i}`}
                  className="list-item"
                  role={t.sessionId ? 'button' : undefined}
                  tabIndex={t.sessionId ? 0 : undefined}
                  onClick={() => t.sessionId && onSelectSession(t.sessionId)}
                  onKeyDown={(e) => {
                    if (t.sessionId && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      onSelectSession(t.sessionId);
                    }
                  }}
                >
                  <div className="row">
                    <strong>{t.title}</strong>
                    {t.status}
                  </div>
                  <div className="row muted" style={{ fontSize: '0.75rem' }}>
                    {t.ownerAgentId ?? '—'}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
