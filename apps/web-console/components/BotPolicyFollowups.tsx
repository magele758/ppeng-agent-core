'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
  parseBotPolicyWarnings,
  type BotPermissionMode,
  withoutStaleTools,
  type BotPolicyWarning
} from '@/lib/bot-permission';

/** Policy warnings are computed by the daemon on every read, so they survive a reload. */
export function BotPolicyWarnings({
  botId,
  refreshKey,
  allowedTools,
  disabled,
  onRemoveStale
}: {
  botId: string | null;
  refreshKey: string;
  allowedTools: readonly string[];
  disabled: boolean;
  onRemoveStale: (next: string[]) => Promise<void>;
}) {
  const { t } = useI18n();
  const [warnings, setWarnings] = useState<BotPolicyWarning[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!botId) {
      setWarnings([]);
      setLoadFailed(false);
      return;
    }
    let cancelled = false;
    void api(`/api/bots/${encodeURIComponent(botId)}`)
      .then((data) => {
        if (cancelled) return;
        setWarnings(parseBotPolicyWarnings((data as { warnings?: unknown }).warnings));
        setLoadFailed(false);
      })
      .catch(() => {
        if (!cancelled) {
          setWarnings([]);
          setLoadFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [botId, refreshKey]);

  return (
    <>
      {loadFailed ? (
        <div className="bot-cron-panel__err" role="alert">
          <p>{t('play.botPolicy.warningsFailed')}</p>
        </div>
      ) : null}
      {warnings.map((warning) => {
        if (warning.code === 'stale_allowed_tools') {
          const emptiesList = withoutStaleTools(allowedTools, warning.tools).length === 0;
          return (
            <div key={warning.code} className="bot-cron-panel__err" role="alert">
              <p>{t('play.botPolicy.staleAllowedTools', { tools: warning.tools.join(', ') })}</p>
              {emptiesList ? <p>{t('play.botPolicy.removeStaleEmpties')}</p> : null}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={disabled}
                onClick={() => void onRemoveStale(withoutStaleTools(allowedTools, warning.tools))}
              >
                {t('play.botPolicy.removeStale')}
              </button>
            </div>
          );
        }
        return (
          <div key={warning.code} className="bot-cron-panel__err" role="alert">
            <p>{t('play.botPolicy.missingRequiredTools', { tools: warning.tools.join(', ') })}</p>
            {warning.unverifiedMcpTools.length > 0 ? (
              <p>
                {t('play.botPolicy.unverifiedMcpTools', {
                  tools: warning.unverifiedMcpTools.join(', ')
                })}
              </p>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/** One-click way out of an old bypass Bot. Never runs on its own. */
export function BotBypassRevert({
  permissionMode,
  disabled,
  onRevert
}: {
  permissionMode: BotPermissionMode;
  disabled: boolean;
  onRevert: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (permissionMode !== 'bypass') setConfirming(false);
  }, [permissionMode]);

  if (permissionMode !== 'bypass') return null;

  if (!confirming) {
    return (
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={disabled}
        onClick={() => setConfirming(true)}
      >
        {t('play.botPolicy.revertToAuto')}
      </button>
    );
  }

  return (
    <div
      className="bot-policy-confirm"
      role="alertdialog"
      aria-label={t('play.botPolicy.revertConfirmTitle')}
    >
      <strong>{t('play.botPolicy.revertConfirmTitle')}</strong>
      <p>{t('play.botPolicy.revertConfirmBody')}</p>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={disabled}
        onClick={() => {
          setConfirming(false);
          void onRevert();
        }}
      >
        {t('play.botPolicy.revertConfirm')}
      </button>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={disabled}
        onClick={() => setConfirming(false)}
      >
        {t('play.botPolicy.revertCancel')}
      </button>
    </div>
  );
}
