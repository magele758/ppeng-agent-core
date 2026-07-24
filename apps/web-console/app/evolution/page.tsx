'use client';

import { renderMarkdown } from '@/lib/markdown';
import { useCallback, useEffect, useRef, useState } from 'react';

interface ActiveWorktree {
  path: string;
  head: string;
  branch: string;
  isEvolution: boolean;
}

interface EvolutionOverview {
  activeWorktrees: ActiveWorktree[];
  latestRunLog: string | null;
  inboxHint: string | null;
  counts: Record<string, number>;
}

interface EvolutionResult {
  type: string;
  name: string;
  status: string;
  sourceTitle: string;
  sourceUrl: string;
  experimentBranch: string;
  dateUtc: string;
  merged: boolean;
  skipReason?: string;
  noOpReason?: string;
  featurePathsCount?: number;
  detectedTool: string | null;
}

const TYPE_LABELS: Record<string, { label: string; cls: string }> = {
  success: { label: '✓ 成功', cls: 'ev-badge ev-badge--success' },
  failure: { label: '✗ 失败', cls: 'ev-badge ev-badge--failure' },
  skip: { label: '⊘ 跳过', cls: 'ev-badge ev-badge--skip' },
  'no-op': { label: '— 无效', cls: 'ev-badge ev-badge--noop' }
};

function shortBranch(branch: string) {
  return branch.replace('exp/evolution-', '').slice(0, 40);
}

function shortPath(p: string) {
  const idx = p.lastIndexOf('/');
  return idx >= 0 ? p.slice(idx + 1) : p;
}

export default function EvolutionPage() {
  const [overview, setOverview] = useState<EvolutionOverview | null>(null);
  const [results, setResults] = useState<EvolutionResult[]>([]);
  const [detail, setDetail] = useState<{ markdown: string; name: string; type: string } | null>(null);
  const [logExpanded, setLogExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [resultsLoading, setResultsLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/evolution/overview');
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = (await res.json()) as EvolutionOverview;
      setOverview(data);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchResults = useCallback(async () => {
    try {
      const res = await fetch('/api/evolution/results');
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = (await res.json()) as { results: EvolutionResult[] };
      setResults(data.results);
    } catch {
      // non-fatal
    } finally {
      setResultsLoading(false);
    }
  }, []);

  const openDetail = useCallback(async (r: EvolutionResult) => {
    try {
      const res = await fetch(`/api/evolution/result?type=${encodeURIComponent(r.type)}&name=${encodeURIComponent(r.name)}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as { markdown: string; type: string; name: string };
      setDetail(data);
      setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (e) {
      setDetail({ markdown: `加载失败: ${e instanceof Error ? e.message : String(e)}`, type: r.type, name: r.name });
    }
  }, []);

  useEffect(() => {
    void fetchOverview();
    void fetchResults();
    const timer = setInterval(() => void fetchOverview(), 8000);
    return () => clearInterval(timer);
  }, [fetchOverview, fetchResults]);

  return (
    <div className="ev-page">
      <style>{`
        .ev-page {
          padding: 24px;
          max-width: 1280px;
          margin: 0 auto;
          font-family: var(--font-family-stack);
          font-size: var(--font-size-base);
          line-height: var(--line-height-base);
          color: var(--color-text-primary);
          background: var(--color-surface-base);
          min-height: 100vh;
        }
        .ev-back {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: var(--color-text-secondary);
          font-size: var(--font-size-sm);
          text-decoration: underline;
          text-underline-offset: 2px;
          margin-bottom: 20px;
        }
        .ev-back:hover { filter: brightness(1.15); }
        .ev-back:focus-visible {
          outline: 2px solid var(--color-text-secondary);
          outline-offset: 2px;
        }
        .ev-header { display: flex; align-items: baseline; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
        .ev-header h1 { font-size: var(--font-size-md); font-weight: 700; margin: 0; }
        .ev-header .muted { font-size: var(--font-size-xs); color: var(--muted); }
        .ev-counts { display: flex; gap: 10px; flex-wrap: wrap; }
        .ev-count-chip {
          padding: 3px 10px;
          border-radius: var(--radius-sm);
          font-size: var(--font-size-xs);
          font-weight: 600;
          background: var(--color-surface-strong);
          border: 1px solid var(--color-border-strong);
        }
        .ev-count-chip--success { background: var(--accent-soft); color: var(--color-surface-raised); border-color: var(--color-surface-raised); }
        .ev-count-chip--failure { background: rgba(251,113,133,.12); color: var(--color-danger); border-color: var(--color-danger); }
        .ev-count-chip--skip { background: rgba(251,191,36,.1); color: var(--color-warn); border-color: var(--color-warn); }
        .ev-count-chip--noop { color: var(--muted); }

        .ev-section {
          background: var(--color-surface-strong);
          border: 1px solid var(--color-border-strong);
          border-radius: var(--radius-xs);
          padding: 16px;
          margin-bottom: 16px;
        }
        .ev-section-title {
          font-size: var(--font-size-xs);
          font-weight: 600;
          letter-spacing: .06em;
          text-transform: uppercase;
          color: var(--muted);
          margin: 0 0 14px;
        }
        .ev-empty { color: var(--muted); font-size: var(--font-size-sm); padding: 8px 0; }
        .ev-error { color: var(--color-danger); font-size: var(--font-size-sm); padding: 8px 0; }

        .ev-wt-list { display: flex; flex-direction: column; gap: 8px; }
        .ev-wt-item {
          background: var(--color-surface-base);
          border: 1px solid var(--color-border-strong);
          border-radius: var(--radius-xs);
          padding: 10px 14px;
          font-size: var(--font-size-xs);
          line-height: 1.5;
        }
        .ev-wt-branch { font-family: var(--mono); color: var(--color-surface-raised); font-weight: 600; }
        .ev-wt-path { color: var(--muted); font-family: var(--mono); }
        .ev-wt-head { color: var(--muted); font-size: 0.75rem; }

        .ev-log-wrap { position: relative; }
        .ev-log {
          background: var(--color-surface-base);
          border: 1px solid var(--color-border-strong);
          border-radius: var(--radius-xs);
          padding: 14px 16px;
          font-family: var(--mono);
          font-size: 0.78rem;
          line-height: 1.6;
          white-space: pre-wrap;
          word-break: break-all;
          color: var(--muted);
          overflow: hidden;
        }
        .ev-log--collapsed { max-height: 200px; }
        .ev-log-fade {
          position: absolute; bottom: 0; left: 0; right: 0; height: 60px;
          background: linear-gradient(transparent, var(--color-surface-base));
          pointer-events: none;
          border-radius: 0 0 var(--radius-xs) var(--radius-xs);
        }
        .ev-log-toggle {
          margin-top: 8px;
          font-size: var(--font-size-xs);
          color: var(--color-text-secondary);
          cursor: pointer;
          background: none;
          border: none;
          padding: 0;
          text-decoration: underline;
        }
        .ev-log-toggle:hover { filter: brightness(1.15); }
        .ev-log-toggle:focus-visible {
          outline: 2px solid var(--color-text-secondary);
          outline-offset: 2px;
        }

        .ev-table-wrap { overflow-x: auto; }
        .ev-table { width: 100%; border-collapse: collapse; font-size: var(--font-size-xs); }
        .ev-table th {
          text-align: left; padding: 6px 10px; color: var(--muted); font-weight: 600;
          border-bottom: 1px solid var(--color-border-strong); white-space: nowrap;
        }
        .ev-table td { padding: 8px 10px; border-bottom: 1px solid var(--color-border-strong); vertical-align: top; }
        .ev-table tr:last-child td { border-bottom: none; }
        .ev-table tr.ev-clickable { cursor: pointer; }
        .ev-table tr.ev-clickable:hover td { background: #1a1a1a; }
        .ev-table tr.ev-selected td { background: var(--accent-soft); }
        .ev-title-cell { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ev-branch-cell {
          font-family: var(--mono); color: var(--color-surface-raised); font-size: 0.75rem;
          max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .ev-date-cell { color: var(--muted); white-space: nowrap; }
        .ev-tool-cell { font-size: 0.75rem; }
        .ev-tool-tag {
          padding: 2px 7px; border-radius: var(--radius-sm);
          background: var(--accent-soft); color: var(--color-surface-raised); font-family: var(--mono);
        }

        .ev-badge {
          display: inline-block; padding: 2px 8px; border-radius: var(--radius-sm);
          font-size: 0.72rem; font-weight: 600; white-space: nowrap;
        }
        .ev-badge--success { background: var(--accent-soft); color: var(--color-surface-raised); }
        .ev-badge--failure { background: rgba(251,113,133,.12); color: var(--color-danger); }
        .ev-badge--skip { background: rgba(251,191,36,.1); color: var(--color-warn); }
        .ev-badge--noop { background: var(--color-surface-base); color: var(--muted); }

        .ev-detail {
          background: var(--color-surface-strong);
          border: 1px solid var(--color-surface-raised);
          border-radius: var(--radius-xs);
          padding: 20px;
          margin-top: 16px;
        }
        .ev-detail-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; gap: 12px; flex-wrap: wrap; }
        .ev-detail-title { font-size: var(--font-size-sm); font-weight: 600; color: var(--color-text-primary); word-break: break-all; }
        .ev-detail-close {
          background: none; border: none; color: var(--muted); font-size: 1.2rem; cursor: pointer; padding: 0 4px; line-height: 1;
        }
        .ev-detail-close:hover { color: var(--color-danger); }
        .ev-detail-close:focus-visible {
          outline: 2px solid var(--color-text-secondary);
          outline-offset: 2px;
        }
        .ev-detail-body { font-size: var(--font-size-sm); line-height: 1.7; }
        .ev-detail-body h1,.ev-detail-body h2,.ev-detail-body h3 { margin-top: 1.2em; margin-bottom: 0.4em; }
        .ev-detail-body pre {
          background: var(--color-surface-base); border: 1px solid var(--color-border-strong);
          border-radius: var(--radius-xs); padding: 12px; overflow-x: auto; font-size: 0.78rem;
        }
        .ev-detail-body code {
          font-family: var(--mono); background: var(--color-surface-base); padding: 1px 5px;
          border-radius: var(--radius-xs); font-size: 0.82em;
        }
        .ev-detail-body pre code { background: none; padding: 0; }
        .ev-detail-body a { color: var(--color-text-secondary); }
        .ev-detail-body table { border-collapse: collapse; width: 100%; }
        .ev-detail-body td,.ev-detail-body th { border: 1px solid var(--color-border-strong); padding: 4px 8px; }

        @media (max-width: 640px) {
          .ev-page { padding: 14px; }
          .ev-table th:nth-child(4), .ev-table td:nth-child(4) { display: none; }
        }
      `}</style>

      <a href="/" className="ev-back">← 返回 Agent Home</a>

      <div className="ev-header">
        <h1>Evolution 观测</h1>
        {overview && (
          <div className="ev-counts">
            {(['success', 'failure', 'skip', 'no-op'] as const).map((t) => (
              <span key={t} className={`ev-count-chip ev-count-chip--${t === 'no-op' ? 'noop' : t}`}>
                {t} · {overview.counts[t] ?? 0}
              </span>
            ))}
            {overview.inboxHint && (
              <span className="ev-count-chip">收件箱 · {overview.inboxHint}</span>
            )}
          </div>
        )}
        {loading && <span className="muted" style={{ fontSize: '0.8rem' }}>加载中…</span>}
        {err && <span className="ev-error">{err}</span>}
      </div>

      {/* Active worktrees */}
      <div className="ev-section">
        <p className="ev-section-title">进行中的 Worktree（每 8s 刷新）</p>
        {!overview ? null : overview.activeWorktrees.length === 0 ? (
          <p className="ev-empty">当前无进化中的 worktree — 未在运行或已全部清理</p>
        ) : (
          <div className="ev-wt-list">
            {overview.activeWorktrees.map((wt, i) => (
              <div key={i} className="ev-wt-item">
                <div className="ev-wt-branch">{wt.branch}</div>
                <div className="ev-wt-path">{wt.path}</div>
                <div className="ev-wt-head">HEAD {wt.head.slice(0, 12)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Latest run log */}
      {overview?.latestRunLog && (
        <div className="ev-section">
          <p className="ev-section-title">最近一次 Run 日志</p>
          <div className="ev-log-wrap">
            <pre className={`ev-log${logExpanded ? '' : ' ev-log--collapsed'}`}>
              {overview.latestRunLog}
            </pre>
            {!logExpanded && <div className="ev-log-fade" />}
          </div>
          <button className="ev-log-toggle" onClick={() => setLogExpanded((v) => !v)}>
            {logExpanded ? '收起' : '展开全文'}
          </button>
        </div>
      )}

      {/* Results table */}
      <div className="ev-section">
        <p className="ev-section-title">历史结果（点击行查看详情）</p>
        {resultsLoading ? (
          <p className="ev-empty">加载中…</p>
        ) : results.length === 0 ? (
          <p className="ev-empty">暂无历史记录</p>
        ) : (
          <div className="ev-table-wrap">
            <table className="ev-table">
              <thead>
                <tr>
                  <th>状态</th>
                  <th>标题</th>
                  <th>分支</th>
                  <th>时间</th>
                  <th>工具</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => {
                  const badge = TYPE_LABELS[r.type] ?? { label: r.type, cls: 'ev-badge' };
                  const isSelected = detail?.name === r.name && detail?.type === r.type;
                  return (
                    <tr
                      key={i}
                      className={`ev-clickable${isSelected ? ' ev-selected' : ''}`}
                      onClick={() => void openDetail(r)}
                    >
                      <td><span className={badge.cls}>{badge.label}</span></td>
                      <td className="ev-title-cell" title={r.sourceTitle}>{r.sourceTitle || r.name}</td>
                      <td className="ev-branch-cell" title={r.experimentBranch}>{shortBranch(r.experimentBranch) || '—'}</td>
                      <td className="ev-date-cell">{r.dateUtc ? r.dateUtc.slice(0, 16).replace('T', ' ') : '—'}</td>
                      <td className="ev-tool-cell">
                        {r.detectedTool ? <span className="ev-tool-tag">{r.detectedTool}</span> : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail panel */}
      {detail && (
        <div className="ev-detail" ref={detailRef}>
          <div className="ev-detail-header">
            <span className="ev-detail-title">{detail.name}</span>
            <button className="ev-detail-close" aria-label="关闭详情" onClick={() => setDetail(null)}>×</button>
          </div>
          <div
            className="ev-detail-body"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: renderMarkdown(detail.markdown) }}
          />
        </div>
      )}
    </div>
  );
}
