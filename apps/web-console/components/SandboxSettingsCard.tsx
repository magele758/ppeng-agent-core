'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n, type MessageKey } from '@/lib/i18n';

type SandboxMode = 'auto' | 'direct' | 'os' | 'container' | 'cloudflare-computer';

interface SandboxSettings {
  mode: SandboxMode;
  cfEndpoint: string;
  cfWorkspaceName: string;
  cfAccountId: string;
  cfTimeoutMs: number;
  cfBackend: '' | 'worker-shell' | 'container-shell';
  cfTokenSecretName: string;
  updatedAt: string;
}

interface Effective {
  mode: SandboxMode;
  source: string;
  cfEndpoint: string;
  cfWorkspaceName: string;
  tokenPresent: boolean;
  tokenSource: string;
}

interface SettingsResponse {
  settings: SandboxSettings;
  effective: Effective;
}

const MODE_IDS: SandboxMode[] = ['auto', 'direct', 'os', 'container', 'cloudflare-computer'];

function sandboxModeKey(id: SandboxMode): MessageKey {
  switch (id) {
    case 'auto':
      return 'more.sandboxModeAuto';
    case 'direct':
      return 'more.sandboxModeDirect';
    case 'os':
      return 'more.sandboxModeOs';
    case 'container':
      return 'more.sandboxModeContainer';
    case 'cloudflare-computer':
      return 'more.sandboxModeCf';
    default: {
      const _never: never = id;
      return _never;
    }
  }
}

export function SandboxSettingsCard() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<SandboxSettings | null>(null);
  const [effective, setEffective] = useState<Effective | null>(null);
  const [draft, setDraft] = useState<SandboxSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const apply = (data: SettingsResponse) => {
    setSettings(data.settings);
    setDraft(data.settings);
    setEffective(data.effective);
  };

  const load = useCallback(async () => {
    setErr(null);
    try {
      apply((await api('/api/sandbox/settings')) as SettingsResponse);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (patch: Partial<SandboxSettings>) => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const data = (await api('/api/sandbox/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      })) as SettingsResponse;
      apply(data);
      setMsg(t('more.savedNoRestart'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!settings || !draft) {
    return (
      <div className="card">
        <div className="card-head">
          <h3>{t('more.sandboxTitle')}</h3>
        </div>
        {err ? <p className="muted">{err}</p> : <p className="muted">{t('more.loadingSettings')}</p>}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h3>{t('more.sandboxTitle')}</h3>
        <span className="badge">{effective?.source === 'ui' ? t('more.sourceUi') : t('more.sourceEnv')}</span>
      </div>
      <p className="muted" style={{ fontSize: '0.8rem', marginTop: 0 }}>
        {t('more.sandboxDescBefore')}
        <code>POST /c/&lt;name&gt;/exec</code>
        {t('more.sandboxDescAfter')}
      </p>
      <label className="field">
        <span>{t('more.sandboxMode')}</span>
        <select
          value={settings.mode}
          disabled={busy}
          onChange={(e) => void save({ mode: e.target.value as SandboxMode })}
        >
          {MODE_IDS.map((id) => (
            <option key={id} value={id}>
              {t(sandboxModeKey(id))}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t('more.sandboxEndpoint')}</span>
        <input
          type="url"
          placeholder="https://your-computer.workers.dev"
          value={draft.cfEndpoint}
          disabled={busy}
          onChange={(e) => setDraft({ ...draft, cfEndpoint: e.target.value })}
        />
      </label>
      <label className="field">
        <span>{t('more.sandboxWorkspace')}</span>
        <input
          value={draft.cfWorkspaceName}
          disabled={busy}
          onChange={(e) => setDraft({ ...draft, cfWorkspaceName: e.target.value })}
        />
      </label>
      <label className="field">
        <span>{t('more.sandboxAccount')}</span>
        <input
          value={draft.cfAccountId}
          disabled={busy}
          onChange={(e) => setDraft({ ...draft, cfAccountId: e.target.value })}
        />
      </label>
      <label className="field">
        <span>{t('more.sandboxTimeout')}</span>
        <input
          type="number"
          min={1000}
          max={600000}
          value={draft.cfTimeoutMs}
          disabled={busy}
          onChange={(e) => setDraft({ ...draft, cfTimeoutMs: Number(e.target.value) || draft.cfTimeoutMs })}
        />
      </label>
      <label className="field">
        <span>{t('more.sandboxBackend')}</span>
        <select
          value={draft.cfBackend}
          disabled={busy}
          onChange={(e) =>
            setDraft({ ...draft, cfBackend: e.target.value as SandboxSettings['cfBackend'] })
          }
        >
          <option value="">{t('more.sandboxBackendNone')}</option>
          <option value="worker-shell">worker-shell</option>
          <option value="container-shell">container-shell</option>
        </select>
      </label>
      <label className="field">
        <span>{t('more.sandboxTokenName')}</span>
        <input
          placeholder="CLOUDFLARE_COMPUTER_TOKEN"
          value={draft.cfTokenSecretName}
          disabled={busy}
          onChange={(e) => setDraft({ ...draft, cfTokenSecretName: e.target.value })}
        />
      </label>
      <p className="muted" style={{ fontSize: '0.75rem' }}>
        {t('more.sandboxSecretPrefix')}
        <code>PUT /api/secrets/CLOUDFLARE_COMPUTER_TOKEN</code>
        {' '}
        {t('more.sandboxSecretOrEnv')} <code>CLOUDFLARE_COMPUTER_TOKEN</code>
        {t('more.sandboxSecretCurrent')}
        {effective?.tokenPresent
          ? t('more.sandboxTokenResolved', { source: effective.tokenSource })
          : t('more.sandboxTokenMissing')}
      </p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={() =>
            void save({
              cfEndpoint: draft.cfEndpoint,
              cfWorkspaceName: draft.cfWorkspaceName,
              cfAccountId: draft.cfAccountId,
              cfTimeoutMs: draft.cfTimeoutMs,
              cfBackend: draft.cfBackend,
              cfTokenSecretName: draft.cfTokenSecretName
            })
          }
        >
          {t('more.sandboxSaveConn')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void load()}>
          {t('common.refresh')}
        </button>
      </div>
      {msg ? <p className="muted small">{msg}</p> : null}
      {err ? <p className="muted small">{err}</p> : null}
    </div>
  );
}
