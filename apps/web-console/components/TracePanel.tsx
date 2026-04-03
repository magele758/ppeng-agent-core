'use client';

import type { SessionSummary } from '@/lib/types';

export interface TracePanelProps {
  active: boolean;
  sessions: SessionSummary[];
  traceSessionId: string;
  traceRows: { kind: string; ts: string; payload?: unknown }[];
  onTraceSessionIdChange: (id: string) => void;
  onLoadTrace: () => void;
}

export function TracePanel({
  active,
  sessions,
  traceSessionId,
  traceRows,
  onTraceSessionIdChange,
  onLoadTrace,
}: TracePanelProps) {
  return (
    <section className={`panel ${active ? 'active' : ''}`} id="panel-trace" role="tabpanel">
      <div className="card card-elevated">
        <div className="card-head">
          <h3>Trace 时间线</h3>
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
        <p className="muted small">
          来源：<code>stateDir/traces/&lt;sessionId&gt;/events.jsonl</code>
        </p>
        <div className="trace-timeline" id="traceTimeline">
          {!traceRows.length ? (
            <div className="empty-hint">选择会话并点击加载</div>
          ) : (
            traceRows.map((ev, i) => (
              <div key={i} className="trace-row">
                <span className="trace-kind">{ev.kind}</span>
                <span className="trace-ts">{ev.ts}</span>
                <span className="trace-payload">{JSON.stringify(ev.payload ?? {})}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
