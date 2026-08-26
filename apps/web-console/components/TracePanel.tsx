'use client';

import { useMemo, useState } from 'react';
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
          <h3>Trace</h3>
          <select
            id="traceSessionSelect"
            className="select-wide"
            aria-label="选择会话以加载 trace"
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
            加载
          </button>
        </div>
        <p className="muted small">按 turn 分组 · 条长≈相对耗时 · 点行展开 payload</p>
        <div className="trace-timeline" id="traceTimeline">
          {!groups.length ? (
            <div className="empty-hint">选择会话并点击加载</div>
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
                      {g.events.length} events
                      {g.durationMs != null ? ` · ${(g.durationMs / 1000).toFixed(2)}s` : ''}
                      {g.hasError ? ' · error' : ''}
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
                                  <strong>发生了什么</strong>：{hint.what}
                                </div>
                                <div>
                                  <strong>为何</strong>：{hint.why}
                                </div>
                                <div>
                                  <strong>下一步</strong>：{hint.next}
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
