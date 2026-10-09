'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
  buildGatewayPatch,
  draftFromView,
  isGatewayDirty,
  type GatewayDraft,
  type GatewaySettingsView
} from '@/lib/gateway-settings';
import { useLab } from './shell/LabProvider';
import { SaveStatus, type SaveState } from './sections/settings/SaveStatus';
import { SettingsGroup } from './ui';
import './sections/settings/settings.css';

interface SecretFieldProps {
  id: string;
  label: string;
  isSet: boolean;
  value: string;
  clearing: boolean;
  clearLabel: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onToggleClear: () => void;
}

/** Write-only secret input: shows only "set / not set", never the stored value. */
function SecretField({ id, label, isSet, value, clearing, clearLabel, disabled, onChange, onToggleClear }: SecretFieldProps) {
  const { t } = useI18n();
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        <span className={`status-pill status-pill--${isSet && !clearing ? 'ok' : 'unchecked'}`}>
          {clearing ? t('settings.gateway.willClear') : isSet ? t('settings.gateway.secretSet') : t('settings.gateway.secretUnset')}
        </span>
      </label>
      <div className="input-with-action">
        <input
          id={id}
          type="password"
          value={value}
          disabled={disabled || clearing}
          autoComplete="new-password"
          spellCheck={false}
          placeholder={isSet ? t('settings.gateway.secretKeep') : t('settings.gateway.secretPlaceholder')}
          onChange={(e) => onChange(e.target.value)}
        />
        {isSet ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label={clearing ? t('settings.gateway.undoClear') : clearLabel}
            aria-pressed={clearing}
            disabled={disabled}
            onClick={onToggleClear}
          >
            {clearing ? t('settings.gateway.undoClear') : t('settings.gateway.clear')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function GatewaySettingsCard() {
  const { t } = useI18n();
  const { bots } = useLab();
  const [view, setView] = useState<GatewaySettingsView | null>(null);
  const [draft, setDraft] = useState<GatewayDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = (await api('/api/gateway/settings')) as { settings: GatewaySettingsView };
      setView(res.settings);
      setDraft(draftFromView(res.settings));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => (view && draft ? isGatewayDirty(view, draft) : false), [view, draft]);

  if (!view || !draft) {
    return (
      <div className="card" id="card-gateway">
        <SettingsGroup title={t('settings.gateway.title')} description={t('settings.gateway.desc')}>
          <div className="empty-hint">{loadError ? t('settings.gateway.unavailable') : t('common.loading')}</div>
        </SettingsGroup>
      </div>
    );
  }

  const edit = (mutate: (d: GatewayDraft) => void) => {
    const next: GatewayDraft = {
      feishu: { ...draft.feishu },
      wecom: { ...draft.wecom },
      webhook: { ...draft.webhook }
    };
    mutate(next);
    setDraft(next);
    setJustSaved(false);
    setErr(null);
  };

  const save = async () => {
    setBusy(true);
    setErr(null);
    setJustSaved(false);
    try {
      const res = (await api('/api/gateway/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildGatewayPatch(view, draft))
      })) as { settings: GatewaySettingsView };
      setView(res.settings);
      setDraft(draftFromView(res.settings));
      setJustSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const botOptions = (current: string) => {
    const known = bots.some((b) => b.id === current);
    return (
      <>
        <option value="">{t('settings.gateway.botNone')}</option>
        {current && !known ? <option value={current}>{current}</option> : null}
        {bots.map((b) => (
          <option key={b.id} value={b.id}>
            {b.title || b.name}
          </option>
        ))}
      </>
    );
  };

  const saveState: SaveState = busy ? 'saving' : err ? 'error' : dirty ? 'dirty' : justSaved ? 'saved' : 'clean';

  return (
    <div className="card" id="card-gateway">
      <SettingsGroup title={t('settings.gateway.title')} description={t('settings.gateway.desc')}>
        <SettingsGroup title={t('settings.gateway.feishu.title')} description={t('settings.gateway.feishu.desc')}>
          <div className="row-3">
            <SecretField
              id="gw-feishu-token"
              label={t('settings.gateway.feishu.verificationToken')}
              isSet={view.feishu.verificationTokenSet}
              value={draft.feishu.verificationToken}
              clearing={draft.feishu.clearVerificationToken}
              clearLabel={t('settings.gateway.clearNamed', { name: t('settings.gateway.feishu.verificationToken') })}
              disabled={busy}
              onChange={(v) => edit((d) => void (d.feishu.verificationToken = v))}
              onToggleClear={() => edit((d) => void (d.feishu.clearVerificationToken = !d.feishu.clearVerificationToken))}
            />
            <SecretField
              id="gw-feishu-encrypt"
              label={t('settings.gateway.feishu.encryptKey')}
              isSet={view.feishu.encryptKeySet}
              value={draft.feishu.encryptKey}
              clearing={draft.feishu.clearEncryptKey}
              clearLabel={t('settings.gateway.clearNamed', { name: t('settings.gateway.feishu.encryptKey') })}
              disabled={busy}
              onChange={(v) => edit((d) => void (d.feishu.encryptKey = v))}
              onToggleClear={() => edit((d) => void (d.feishu.clearEncryptKey = !d.feishu.clearEncryptKey))}
            />
          </div>
          <div className="row-3">
            <div className="field">
              <label htmlFor="gw-feishu-senders">{t('settings.gateway.feishu.allowedSenders')}</label>
              <textarea
                id="gw-feishu-senders"
                rows={3}
                value={draft.feishu.allowedSenders}
                disabled={busy}
                spellCheck={false}
                placeholder={t('settings.gateway.sendersPlaceholder')}
                onChange={(e) => edit((d) => void (d.feishu.allowedSenders = e.target.value))}
              />
              <p className="muted small">{t('settings.gateway.sendersHint')}</p>
            </div>
            <div className="field">
              <label htmlFor="gw-feishu-bot">{t('settings.gateway.feishu.botId')}</label>
              <select
                id="gw-feishu-bot"
                value={draft.feishu.botId}
                disabled={busy}
                onChange={(e) => edit((d) => void (d.feishu.botId = e.target.value))}
              >
                {botOptions(draft.feishu.botId)}
              </select>
              <p className="muted small">{t('settings.gateway.botHint')}</p>
            </div>
          </div>
        </SettingsGroup>

        <SettingsGroup title={t('settings.gateway.wecom.title')} description={t('settings.gateway.wecom.desc')}>
          <div className="row-3">
            <SecretField
              id="gw-wecom-secret"
              label={t('settings.gateway.wecom.bridgeSecret')}
              isSet={view.wecom.bridgeSecretSet}
              value={draft.wecom.bridgeSecret}
              clearing={draft.wecom.clearBridgeSecret}
              clearLabel={t('settings.gateway.clearNamed', { name: t('settings.gateway.wecom.bridgeSecret') })}
              disabled={busy}
              onChange={(v) => edit((d) => void (d.wecom.bridgeSecret = v))}
              onToggleClear={() => edit((d) => void (d.wecom.clearBridgeSecret = !d.wecom.clearBridgeSecret))}
            />
          </div>
          <div className="row-3">
            <div className="field">
              <label htmlFor="gw-wecom-senders">{t('settings.gateway.wecom.allowedSenders')}</label>
              <textarea
                id="gw-wecom-senders"
                rows={3}
                value={draft.wecom.allowedSenders}
                disabled={busy}
                spellCheck={false}
                placeholder={t('settings.gateway.sendersPlaceholder')}
                onChange={(e) => edit((d) => void (d.wecom.allowedSenders = e.target.value))}
              />
            </div>
            <div className="field">
              <label htmlFor="gw-wecom-bot">{t('settings.gateway.wecom.botId')}</label>
              <select
                id="gw-wecom-bot"
                value={draft.wecom.botId}
                disabled={busy}
                onChange={(e) => edit((d) => void (d.wecom.botId = e.target.value))}
              >
                {botOptions(draft.wecom.botId)}
              </select>
            </div>
          </div>
        </SettingsGroup>

        <SettingsGroup advanced title={t('settings.gateway.webhook.title')} description={t('settings.gateway.webhook.desc')}>
          <div className="field">
            <label htmlFor="gw-webhook-senders">{t('settings.gateway.webhook.allowedSenders')}</label>
            <textarea
              id="gw-webhook-senders"
              rows={3}
              value={draft.webhook.allowedSenders}
              disabled={busy}
              spellCheck={false}
              placeholder={t('settings.gateway.sendersPlaceholder')}
              onChange={(e) => edit((d) => void (d.webhook.allowedSenders = e.target.value))}
            />
          </div>
        </SettingsGroup>

        <div className="row" style={{ gap: 12, alignItems: 'center' }}>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || !dirty} onClick={() => void save()}>
            {t('settings.gateway.save')}
          </button>
          <SaveStatus state={saveState} error={err} />
        </div>
      </SettingsGroup>
    </div>
  );
}
