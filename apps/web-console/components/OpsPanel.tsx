'use client';

import { useMemo, useState } from 'react';
import { useI18n, type MessageKey } from '@/lib/i18n';
import type { SessionSummary } from '@/lib/types';
import { groupSessionsByDate, type SessionDateBucket } from '@/lib/session-groups';
import { errorHint, groupTraceEvents, isErrorKind, maxDurationMs } from '@/lib/trace-groups';

function dateGroupLabel(
  bucket: SessionDateBucket,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string
): string {
  if (bucket.startsWith('m:')) {
    const [year, month] = bucket.slice(2).split('-');
    return t('ops.sessionMonth', { year, month: Number(month) });
  }
  switch (bucket) {
    case 'today':
      return t('ops.today');
    case 'yesterday':
      return t('ops.yesterday');
    case 'week':
      return t('ops.week');
    case 'month':
      return t('ops.month');
    case 'older':
      return t('ops.older');
    default:
      return t('ops.older');
  }
}

export interface OpsPanelProps {
  active: boolean;
  sessions: SessionSummary[];
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
  traceRows: { kind: string; ts: string; payload?: unknown }[];
}

export function OpsPanel({
  active,
  sessions,
  selectedSessionId,
  onSelectSession,
  traceRows
}: OpsPanelProps) {
  const { t } = useI18n();
  const [filter, setFilter] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => {
      const title = (s.title || '').toLowerCase();
      const agent = (s.agentId || '').toLowerCase();
      const id = s.id.toLowerCase();
      return title.includes(q) || agent.includes(q) || id.includes(q);
    });
  }, [sessions, filter]);
  const groups = useMemo(() => groupSessionsByDate(filtered), [filtered]);
  const turns = useMemo(() => groupTraceEvents(traceRows), [traceRows]);
  const maxMs = useMemo(() => maxDurationMs(turns), [turns]);
  const selected = sessions.find((s) => s.id === selectedSessionId) ?? null;

  return (
    <section className={`panel ${active ? 'active' : ''}`} id="panel-ops" role="tabpanel">
      <div className="ops-traj">
        <div className="card ops-traj__sessions">
          <div className="card-head">
            <h3>{t('ops.sessions')}</h3>
            <span className="badge" id="countSessions">
              {filtered.length}
            </span>
          </div>
          <label className="field" style={{ margin: '0 0 8px' }}>
            <span className="sr-only">{t('ops.filterSessions')}</span>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('ops.filterPh')}
              autoComplete="off"
            />
          </label>
          <div className="list-scroll tall" id="listSessions">
            {!filtered.length ? (
              <div className="empty-hint">{t('ops.emptySessions')}</div>
            ) : (
              groups.map((g) => (
                <section key={g.bucket} className="session-date-group">
                  <h4 className="session-date-group__label">{dateGroupLabel(g.bucket, t)}</h4>
                  <div className="session-date-group__items">
                    {g.sessions.map((s) => (
                      <div
                        key={s.id}
                        className={`list-item list-item--session ${selectedSessionId === s.id ? 'selected' : ''}`}
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
                        <div className="session-item__title">{s.title || t('ops.untitled')}</div>
                        <div className="session-item__meta">
                          <span>
                            {s.agentId || '—'} · {s.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        </div>
        <div className="card ops-traj__trace">
          <div className="card-head">
            <h3>{t('ops.trajectory')}</h3>
            {selected ? (
              <span className="muted" style={{ fontSize: '0.75rem' }}>
                {selected.title || selected.id}
              </span>
            ) : null}
          </div>
          <p className="muted small">{t('ops.trajHint')}</p>
          <div className="trace-timeline" id="traceTimeline">
            {!selectedSessionId ? (
              <div className="empty-hint">{t('ops.emptyPickSession')}</div>
            ) : !turns.length ? (
              <div className="empty-hint">{t('ops.emptyTraj')}</div>
            ) : (
              turns.map((g) => {
                const pct = g.durationMs != null ? Math.max(4, Math.round((g.durationMs / maxMs) * 100)) : 8;
                const open = openId === g.id;
                return (
                  <div
                    key={g.id}
                    className={`trace-group${g.hasError ? ' trace-group--err' : ''}${open ? ' is-open' : ''}`}
                  >
                    <button
                      type="button"
                      className="trace-group__head"
                      onClick={() => setOpenId(open ? null : g.id)}
                      aria-expanded={open}
                    >
                      <span className="trace-group__label">{g.label}</span>
                      <span className="trace-group__meta">
                        {t('ops.eventCount', { n: g.events.length })}
                        {g.durationMs != null ? ` · ${(g.durationMs / 1000).toFixed(2)}s` : ''}
                        {g.hasError ? ` · ${t('ops.errorTag')}` : ''}
                      </span>
                      <span className="trace-group__bar" style={{ width: `${pct}%` }} aria-hidden="true" />
                    </button>
                    {open ? (
                      <div className="trace-group__body">
                        {g.events.map((ev, i) => {
                          const err = isErrorKind(ev.kind);
                          const hint = err ? errorHint(ev.kind, ev.payload) : null;
                          return (
                            <details key={`${g.id}-${i}`} className={`trace-row${err ? ' trace-row--err' : ''}`}>
                              <summary>
                                <span className="trace-kind">{ev.kind}</span>
                                <span className="trace-ts">{ev.ts}</span>
                              </summary>
                              {hint ? (
                                <div className="trace-error-hint">
                                  <div>
                                    <strong>{t('ops.hintWhat')}</strong>：{hint.what}
                                  </div>
                                  <div>
                                    <strong>{t('ops.hintWhy')}</strong>：{hint.why}
                                  </div>
                                  <div>
                                    <strong>{t('ops.hintNext')}</strong>：{hint.next}
                                  </div>
                                </div>
                              ) : null}
                              <pre className="trace-payload">{JSON.stringify(ev.payload ?? {}, null, 2)}</pre>
                            </details>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
