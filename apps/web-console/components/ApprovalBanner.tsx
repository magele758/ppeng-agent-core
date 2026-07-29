'use client';

import { api } from '@/lib/api';
import type { ApprovalItem } from '@/lib/types';

function argsPreview(args: unknown): string {
  try {
    return JSON.stringify(args ?? {}, null, 2);
  } catch {
    return String(args ?? '');
  }
}

export function ApprovalBanner({
  approvals,
  onDone
}: {
  approvals: ApprovalItem[];
  onDone: () => void;
}) {
  if (!approvals.length) return null;

  return (
    <div className="approval-banner" role="region" aria-label="待审批">
      <div className="approval-banner__title">需要你确认后才能继续</div>
      {approvals.map((a) => (
        <div key={a.id} className="approval-banner__item">
          <div className="approval-banner__row">
            <strong>{a.toolName}</strong>
            {a.reason ? <span className="muted small">{a.reason}</span> : null}
          </div>
          <pre className="approval-banner__args">{argsPreview(a.args)}</pre>
          <div className="approval-banner__actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() =>
                void api(`/api/approvals/${a.id}/approve`, { method: 'POST' }).then(() => onDone())
              }
            >
              批准并继续
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() =>
                void api(`/api/approvals/${a.id}/reject`, { method: 'POST' }).then(() => onDone())
              }
            >
              拒绝
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
