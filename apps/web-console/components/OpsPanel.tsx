'use client';

import type { SessionSummary, SocialPostScheduleItem, TaskSummary } from '@/lib/types';

export interface OpsPanelProps {
  active: boolean;
  sessions: SessionSummary[];
  tasks: TaskSummary[];
  socialSchedules: SocialPostScheduleItem[];
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
  onSocialScheduleAction?: (taskId: string, action: 'approve' | 'reject' | 'cancel' | 'run_now') => void;
}

export function OpsPanel({
  active,
  sessions,
  tasks,
  socialSchedules,
  selectedSessionId,
  onSelectSession,
  onSocialScheduleAction
}: OpsPanelProps) {
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
        <div className="card card-elevated" style={{ gridColumn: '1 / -1' }}>
          <div className="card-head">
            <h3>社交发布队列</h3>
            <span className="badge">{socialSchedules.length}</span>
          </div>
          <div className="list-scroll tall" id="listSocialSchedules">
            {!socialSchedules.length ? (
              <div className="empty-hint">暂无排期（agent 使用 schedule_social_post 后出现）</div>
            ) : (
              socialSchedules.map((row) => (
                <div key={row.taskId} className="list-item">
                  <div className="row">
                    <strong>{row.title}</strong>
                    <span className="muted">{row.dispatchState}</span>
                  </div>
                  <div className="row muted" style={{ fontSize: '0.75rem' }}>
                    {row.publishAt} · {row.channels.join(', ')} · {row.approval} · {row.status}
                  </div>
                  {onSocialScheduleAction ? (
                    <div className="row" style={{ gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
                      <button
                        type="button"
                        className="chip"
                        disabled={row.approval === 'approved' || row.dispatchState === 'succeeded'}
                        onClick={() => onSocialScheduleAction(row.taskId, 'approve')}
                      >
                        批准
                      </button>
                      <button
                        type="button"
                        className="chip"
                        disabled={row.approval === 'rejected'}
                        onClick={() => onSocialScheduleAction(row.taskId, 'reject')}
                      >
                        拒绝
                      </button>
                      <button
                        type="button"
                        className="chip"
                        disabled={row.status === 'cancelled' || row.dispatchState === 'succeeded'}
                        onClick={() => onSocialScheduleAction(row.taskId, 'cancel')}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        className="chip chip-ok"
                        disabled={
                          row.approval !== 'approved' ||
                          row.dispatchState === 'succeeded' ||
                          row.status === 'cancelled'
                        }
                        onClick={() => onSocialScheduleAction(row.taskId, 'run_now')}
                      >
                        立即发送
                      </button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
