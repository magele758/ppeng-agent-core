'use client';

import { useMemo } from 'react';
import { useI18n } from '@/lib/i18n';
import type { SessionSummary } from '@/lib/types';
import { groupTraceEvents } from '@/lib/trace-groups';
import { TraceTurnList } from './TraceTurnList';

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
  const groups = useMemo(() => groupTraceEvents(traceRows), [traceRows]);

  return (
    <section
      className={`panel ${active ? 'active' : ''}${embedded ? ' panel--embedded' : ''}`}
      id="panel-trace"
      role="tabpanel"
      hidden={!active}
      inert={!active}
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
            <TraceTurnList rows={traceRows} />
          )}
        </div>
      </div>
    </section>
  );
}
