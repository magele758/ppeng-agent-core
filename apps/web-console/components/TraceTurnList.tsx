'use client';

import { useMemo } from 'react';
import { useI18n, type MessageKey } from '@/lib/i18n';
import {
  errorHint,
  groupTraceEvents,
  isErrorKind,
  isTraceGroupDefaultOpen,
  maxDurationMs,
  type TraceGroupKind,
  type TraceRow
} from '@/lib/trace-groups';

function groupLabelKey(kind: TraceGroupKind): MessageKey {
  switch (kind) {
    case 'turn':
      return 'ops.turnLabel';
    case 'span':
      return 'ops.spanLabel';
    default: {
      const _exhaustive: never = kind;
      throw new Error(`unhandled trace group kind: ${_exhaustive}`);
    }
  }
}

export function TraceTurnList({ rows }: { rows: TraceRow[] }) {
  const { t } = useI18n();
  const turns = useMemo(() => groupTraceEvents(rows), [rows]);
  const maxMs = useMemo(() => maxDurationMs(turns), [turns]);

  return (
    <>
      {turns.map((g, idx) => {
        const pct = g.durationMs != null ? Math.max(4, Math.round((g.durationMs / maxMs) * 100)) : 8;
        return (
          <details
            key={g.id}
            className={`trace-group${g.hasError ? ' trace-group--err' : ''}`}
            defaultOpen={isTraceGroupDefaultOpen(g, idx, turns.length)}
          >
            <summary className="trace-group__head">
              <span className="trace-group__inner">
                <span className="trace-group__chevron" aria-hidden="true" />
                <span className="trace-group__label">{t(groupLabelKey(g.kind), { n: g.turnIndex })}</span>
                <span className="trace-group__meta">
                  {t('ops.eventCount', { n: g.events.length })}
                  {g.durationMs != null ? ` · ${(g.durationMs / 1000).toFixed(2)}s` : ''}
                  {g.hasError ? ` · ${t('ops.errorTag')}` : ''}
                </span>
              </span>
              <span className="trace-group__bar" style={{ width: `${pct}%` }} aria-hidden="true" />
            </summary>
            <div className="trace-group__body">
              {g.events.map((ev, i) => {
                const err = isErrorKind(ev.kind);
                const hint = err ? errorHint(ev.kind, ev.payload) : null;
                return (
                  <details key={`${g.id}-${i}`} className={`trace-row${err ? ' trace-row--err' : ''}`}>
                    <summary className="trace-row__head">
                      <span className="trace-row__inner">
                        <span className="trace-row__chevron" aria-hidden="true" />
                        <span className="trace-kind">{ev.kind}</span>
                        <span className="trace-ts">{ev.ts}</span>
                      </span>
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
          </details>
        );
      })}
    </>
  );
}
