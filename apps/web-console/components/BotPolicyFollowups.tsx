'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
  parseBotPolicyWarnings,
  type BotPermissionMode,
  type BotPolicyWarning
} from '@/lib/bot-permission';

/** Policy warnings are computed by the daemon on every read, so they survive a reload. */
export function BotPolicyWarnings({
  botId,
  refreshKey
}: {
  botId: string | null;
  refreshKey: string;
}) {
  const { t } = useI18n();
  const [warnings, setWarnings] = useState<BotPolicyWarning[]>([]);

  useEffect(() => {
    if (!botId) {
      setWarnings([]);
      return;
    }
    let cancelled = false;
    void api(`/api/bots/${encodeURIComponent(botId)}`)
      .then((data) => {
        if (!cancelled) setWarnings(parseBotPolicyWarnings((data as { warnings?: unknown }).warnings));
      })
      .catch(() => {
        if (!cancelled) setWarnings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [botId, refreshKey]);

  return (
    <>
      {warnings.map((warning) => (
        <p key={warning.code} className="bot-cron-panel__err" role="alert">
          {t('play.botPolicy.missingRequiredTools', { tools: warning.tools.join(', ') })}
        </p>
      ))}
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
