'use client';

import { useI18n } from '@/lib/i18n';
import type { MailItem, SessionSummary } from '@/lib/types';
import { TeamGraph } from './TeamGraph';
import { TeamsDagPanel } from './TeamsDagPanel';

export interface TeamsPanelProps {
  active: boolean;
  sessions: SessionSummary[];
  mailAll: MailItem[];
  graphRedraw: number;
  onGraphRedraw: () => void;
}

export function TeamsPanel({
  active,
  sessions,
  mailAll,
  graphRedraw,
  onGraphRedraw,
}: TeamsPanelProps) {
  const { t } = useI18n();
  return (
    <section className={`panel ${active ? 'active' : ''}`} id="panel-teams" role="tabpanel">
      <div className="card teams-board">
        <div className="card-head">
          <h3>{t('teams.graphTitle')}</h3>
          <button type="button" className="btn btn-ghost btn-sm" id="btnTeamsRefresh" onClick={onGraphRedraw}>
            {t('teams.redraw')}
          </button>
        </div>
        <p className="muted small teams-board__hint">
          {t('teams.graphHint')}
        </p>
        <div className="teams-board__graph">
          <TeamGraph sessions={sessions} redrawToken={graphRedraw} active={active} />
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <h3>{t('teams.mailTitle')}</h3>
          <span className="muted">{t('teams.mailNewest')}</span>
        </div>
        <div className="list-scroll tall" id="listMailAll">
          {!mailAll.length ? (
            <div className="empty-hint">{t('teams.emptyMail')}</div>
          ) : (
            mailAll.map((m, i) => (
              <div key={i} className="list-item" style={{ cursor: 'default' }}>
                <div className="row">
                  <strong>
                    {m.fromAgentId} → {m.toAgentId}
                  </strong>{' '}
                  {m.status}
                </div>
                <div className="muted" style={{ fontSize: '0.75rem' }}>
                  {m.createdAt}
                </div>
                <pre
                  style={{
                    margin: '8px 0 0',
                    fontSize: '0.78rem',
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'var(--mono)',
                  }}
                >
                  {m.content.slice(0, 400)}
                  {m.content.length > 400 ? '…' : ''}
                </pre>
              </div>
            ))
          )}
        </div>
      </div>
      <TeamsDagPanel />
    </section>
  );
}
