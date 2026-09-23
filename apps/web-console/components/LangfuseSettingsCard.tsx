'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface LangfuseSettings {
  configured: boolean;
  baseUrl: string;
  publicKeySet: boolean;
  secretKeySet: boolean;
  enabled: boolean;
  chained: boolean;
  updatedAt: string;
}

export function LangfuseSettingsCard() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<LangfuseSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const apply = (next: LangfuseSettings) => {
    setSettings(next);
    setBaseUrl(next.baseUrl);
    setEnabled(next.enabled);
    setPublicKey('');
    setSecretKey('');
  };

  const load = useCallback(async () => {
    setErr(null);
    try {
      const data = (await api('/api/langfuse/settings')) as { settings: LangfuseSettings };
      apply(data.settings);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const data = (await api('/api/langfuse/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl,
          enabled,
          ...(publicKey.trim() ? { publicKey } : {}),
          ...(secretKey.trim() ? { secretKey } : {})
        })
      })) as { settings: LangfuseSettings };
      apply(data.settings);
      setMsg(t('more.langfuseSaved'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const probe = async () => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const data = (await api('/api/langfuse/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl,
          ...(publicKey.trim() ? { publicKey } : {}),
          ...(secretKey.trim() ? { secretKey } : {})
        })
      })) as { ok: boolean; error?: string };
      setMsg(data.ok ? t('more.langfuseProbeOk') : t('more.langfuseProbeFail'));
      if (!data.ok && data.error) setErr(data.error);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!settings) {
    return (
      <div className="card" id="card-langfuse">
        <h3>{t('more.langfuseTitle')}</h3>
        {err ? <p className="muted">{err}</p> : <p className="muted">{t('more.loadingSettings')}</p>}
      </div>
    );
  }

  return (
    <div className="card" id="card-langfuse">
      <div className="card-head">
        <h3>{t('more.langfuseTitle')}</h3>
        <span className="badge">{settings.chained ? t('more.on') : t('more.off')}</span>
      </div>
      <p className="muted small">{t('more.langfuseDesc')}</p>
      <label className="field">
        <span>{t('more.langfuseBaseUrl')}</span>
        <input
          value={baseUrl}
          disabled={busy}
          placeholder={t('more.langfuseBaseUrlPlaceholder')}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </label>
      <label className="field">
        <span>{t('more.langfusePublicKey')}</span>
        <input
          type="password"
          value={publicKey}
          disabled={busy}
          placeholder={settings.publicKeySet ? t('more.apiKeyKeep') : ''}
          onChange={(e) => setPublicKey(e.target.value)}
        />
      </label>
      <label className="field">
        <span>{t('more.langfuseSecretKey')}</span>
        <input
          type="password"
          value={secretKey}
          disabled={busy}
          placeholder={settings.secretKeySet ? t('more.apiKeyKeep') : ''}
          onChange={(e) => setSecretKey(e.target.value)}
        />
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span>{t('more.langfuseEnable')}</span>
      </label>
      <div className="row-3">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {t('more.langfuseSave')}
        </button>
        <button type="button" className="btn" disabled={busy || !baseUrl.trim()} onClick={() => void probe()}>
          {t('more.langfuseProbe')}
        </button>
      </div>
      <p className="muted small">
        {settings.configured ? t('more.langfuseConfigured') : t('more.langfuseUnconfigured')}
      </p>
      {msg ? <p className="muted small">{msg}</p> : null}
      {err ? <p className="muted small">{err}</p> : null}
    </div>
  );
}
