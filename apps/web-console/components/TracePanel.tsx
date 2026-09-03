'use client';

import { useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import type { SessionSummary } from '@/lib/types';
import { errorHint, groupTraceEvents, isErrorKind, maxDurationMs } from '@/lib/trace-groups';

export interface TracePanelProps {
  active: boolean;
  sessions: SessionSummary[];
  traceSessionId: string;
  traceRows: { kind: string; ts: string; payload?: unknown }[];
  onTraceSessionIdChange: (id: string) => void;
  onLoadTrace: () => void;
  embedded?: boolean;
}

export function TracePanel({
  active,
  sessions,
  traceSessionId,
  traceRows,
  onTraceSessionIdChange,
  onLoadTrace,
  embedded = false
}: TracePanelProps) {
  const { t } = useI18n();
  const [openId, setOpenId] = useState<string | null>(null);
  const groups = useMemo(() => groupTraceEvents(traceRows), [traceRows]);
  const maxMs = useMemo(() => maxDurationMs(groups), [groups]);

  return (
    <section
      className={`panel ${active ? 'active' : ''}${embedded ? ' panel--embedded' : ''}`}
      id="panel-trace"
      role="tabpanel"
    >
      <div className="card">
        <div className="card-head">
          <h3>{t('ops.traceTitle')}</h3>
          <select
            id="traceSessionSelect"
            className="select-wide"
            aria-label={t('ops.traceSelectAria')}
            value={traceSessionId}
            onChange={(e) => onTraceSessionIdChange(e.target.value)}
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title.slice(0, 36)} ({s.mode})
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-secondary" id="btnLoadTrace" onClick={onLoadTrace}>
            {t('ops.load')}
          </button>
        </div>
        <p className="muted small">{t('ops.traceHint')}</p>
        <div className="trace-timeline" id="traceTimeline">
          {!groups.length ? (
            <div className="empty-hint">{t('ops.emptyTrace')}</div>
          ) : (
            groups.map((g) => {
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
    </section>
  );
}
