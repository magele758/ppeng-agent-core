'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import type { SpawnBlocked } from '@/lib/spawn-blocked';

function CopyId({ value, label }: { value: string; label: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="spawn-blocked__id"
      aria-label={t('play.turns.blockedCopy', { label })}
      title={t('play.turns.blockedCopy', { label })}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      <code>{value}</code>
      <span>{copied ? t('play.turns.blockedCopied') : t('play.turns.blockedCopyShort')}</span>
    </button>
  );
}

/** Marker for the collapsed tool-result header. */
export function SpawnBlockedPill() {
  const { t } = useI18n();
  return (
    <span className="chat-tool-fold__pill chat-tool-fold__pill--blocked">{t('play.turns.blockedPill')}</span>
  );
}

/** Shown inside the expanded tool result when a spawn parked on human approval. */
export function SpawnBlockedNotice({ blocked }: { blocked: SpawnBlocked }) {
  const { t } = useI18n();
  return (
    <div className="spawn-blocked" role="alert">
      <strong className="spawn-blocked__title">
        {blocked.kind === 'teammate' ? t('play.turns.blockedTeammate') : t('play.turns.blockedSubagent')}
      </strong>
      {blocked.name ? <p>{t('play.turns.blockedName', { name: blocked.name })}</p> : null}
      {blocked.sessionId ? (
        <p>
          {t('play.turns.blockedSession')} <CopyId value={blocked.sessionId} label={t('play.turns.blockedSession')} />
        </p>
      ) : null}
      {blocked.approvals.length > 0 ? (
        <div>
          <p>{t('play.turns.blockedApprovals')}</p>
          <ul className="spawn-blocked__list">
            {blocked.approvals.map((approval) => (
              <li key={approval.id}>
                <CopyId value={approval.id} label={t('play.turns.blockedApprovalId')} />
                {approval.tool ? <span> {approval.tool}</span> : null}
                {approval.reason ? <span> — {approval.reason}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : blocked.blockedTools.length > 0 ? (
        <p>{t('play.turns.blockedTools', { tools: blocked.blockedTools.join(', ') })}</p>
      ) : null}
      <p className="spawn-blocked__hint">{t('play.turns.blockedHint')}</p>
      {blocked.remediation ? (
        <p className="spawn-blocked__remediation">
          <span>{t('play.turns.blockedRemediation')}</span> {blocked.remediation}
        </p>
      ) : null}
    </div>
  );
}
