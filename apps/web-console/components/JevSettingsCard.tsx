'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type JevProfile = 'off' | 'mini' | 'normal' | 'full' | 'max' | 'custom';
type JevPointId =
  | 'goalGate'
  | 'toolGate'
  | 'compact'
  | 'route'
  | 'contextSelect'
  | 'toolSelect'
  | 'skillSelect'
  | 'sagaGate'
  | 'memorySelect'
  | 'recoveryChoice'
  | 'preTurn'
  | 'ptcDecide';

interface JevPoints {
  goalGate: boolean;
  toolGate: boolean;
  compact: boolean;
  route: boolean;
  contextSelect: boolean;
  toolSelect: boolean;
  skillSelect: boolean;
  sagaGate: boolean;
  memorySelect: boolean;
  recoveryChoice: boolean;
  preTurn: boolean;
  ptcDecide: boolean;
}

interface JevSettings {
  configured: boolean;
  baseUrl: string;
  apiKeySet: boolean;
  model: string;
  profile: JevProfile;
  points: JevPoints;
  activePoints: JevPointId[];
  chained: boolean;
  enabled: boolean;
  modules: JevPoints;
  active: JevPoints;
  catalog: Array<{ id: JevPointId }>;
  profilePresets: Record<'mini' | 'normal' | 'full' | 'max', JevPointId[]>;
  updatedAt: string;
}

const PROFILES: JevProfile[] = ['off', 'mini', 'normal', 'full', 'max', 'custom'];
const POINT_LABEL_KEYS: Record<JevPointId, string> = {
  goalGate: 'more.jevPointGoal',
  toolGate: 'more.jevPointTool',
  compact: 'more.jevPointCompact',
  route: 'more.jevPointRoute',
  contextSelect: 'more.jevPointContextSelect',
  toolSelect: 'more.jevPointToolSelect',
  skillSelect: 'more.jevPointSkillSelect',
  sagaGate: 'more.jevPointSagaGate',
  memorySelect: 'more.jevPointMemorySelect',
  recoveryChoice: 'more.jevPointRecoveryChoice',
  preTurn: 'more.jevPointPreTurn',
  ptcDecide: 'more.jevPointPtcDecide'
};
const PROFILE_LABEL_KEYS: Record<JevProfile, string> = {
  off: 'more.jevProfileOff',
  mini: 'more.jevProfileMini',
  normal: 'more.jevProfileNormal',
  full: 'more.jevProfileFull',
  max: 'more.jevProfileMax',
  custom: 'more.jevProfileCustom'
};

export function JevSettingsCard() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<JevSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('jev-latest');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const apply = (next: JevSettings) => {
    setSettings(next);
    setBaseUrl(next.baseUrl);
    setModel(next.model || 'jev-latest');
    setApiKey('');
  };

  const load = useCallback(async () => {
    setErr(null);
    try {
      const data = (await api('/api/jev/settings')) as { settings: JevSettings };
      apply(data.settings);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (patch: Record<string, unknown>) => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const data = (await api('/api/jev/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      })) as { settings: JevSettings };
      apply(data.settings);
      setMsg(t('more.jevSaved'));
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
      const data = (await api('/api/jev/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl,
          model,
          ...(apiKey.trim() ? { apiKey } : {})
        })
      })) as { ok: boolean };
      setMsg(data.ok ? t('more.jevProbeOk') : t('more.jevProbeFail'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!settings) {
    return (
      <div className="card" id="card-jev">
        <h3>{t('more.jevTitle')}</h3>
        {err ? <p className="muted">{err}</p> : <p className="muted">{t('more.loadingSettings')}</p>}
      </div>
    );
  }

  const profile = settings.profile ?? 'off';
  const isCustom = profile === 'custom';
  const entryOk = settings.configured;
  const presetPoints =
    profile === 'mini' || profile === 'normal' || profile === 'full' || profile === 'max'
      ? (settings.profilePresets?.[profile] ?? settings.activePoints)
      : settings.activePoints;

  return (
    <div className="card" id="card-jev">
      <div className="card-head">
        <h3>{t('more.jevTitle')}</h3>
        <span className="badge">{settings.chained ? t('more.on') : t('more.off')}</span>
      </div>
      <p className="muted small">{t('more.jevDesc')}</p>
      <p className="muted small">{t('more.jevLoopHint')}</p>
      <label className="field">
        <span>{t('more.jevBaseUrl')}</span>
        <input
          value={baseUrl}
          disabled={busy}
          placeholder={t('more.jevBaseUrlPlaceholder')}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </label>
      <label className="field">
        <span>{t('more.jevApiKey')}</span>
        <input
          type="password"
          value={apiKey}
          disabled={busy}
          placeholder={settings.apiKeySet ? t('more.apiKeyKeep') : t('more.jevApiKeyPlaceholder')}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </label>
      <label className="field">
        <span>{t('more.jevModel')}</span>
        <input value={model} disabled={busy} onChange={(e) => setModel(e.target.value)} />
      </label>
      <div className="row-3">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void save({ baseUrl, model, ...(apiKey.trim() ? { apiKey } : {}) })}
        >
          {t('more.jevSaveEntry')}
        </button>
        <button type="button" className="btn" disabled={busy || !baseUrl.trim()} onClick={() => void probe()}>
          {t('more.jevProbe')}
        </button>
      </div>
      <p className="muted small">{entryOk ? t('more.jevConfigured') : t('more.jevUnconfigured')}</p>

      <label className="field">
        <span>{t('more.jevProfile')}</span>
        <select
          value={profile}
          disabled={busy || !entryOk}
          onChange={(e) => void save({ profile: e.target.value as JevProfile })}
        >
          {PROFILES.map((p) => (
            <option key={p} value={p}>
              {t(PROFILE_LABEL_KEYS[p])}
            </option>
          ))}
        </select>
      </label>
      {!entryOk ? <p className="muted small">{t('more.jevProfileNeedsEntry')}</p> : null}

      {isCustom ? (
        <div className="stack-gaps">
          <p className="muted small">{t('more.jevCustomHint')}</p>
          {(settings.catalog ?? []).map((item) => (
            <label key={item.id} className="toggle">
              <input
                type="checkbox"
                checked={Boolean(settings.points?.[item.id])}
                disabled={busy || !entryOk}
                onChange={(e) => void save({ points: { [item.id]: e.target.checked } })}
              />
              <span>{t(POINT_LABEL_KEYS[item.id])}</span>
            </label>
          ))}
        </div>
      ) : profile !== 'off' ? (
        <div>
          <p className="muted small">{t('more.jevPresetReadOnly')}</p>
          {presetPoints.length === 0 ? (
            <p className="muted small">{t('more.jevPresetEmpty')}</p>
          ) : (
            <ul className="muted small">
              {presetPoints.map((id) => (
                <li key={id}>{t(POINT_LABEL_KEYS[id])}</li>
              ))}
            </ul>
          )}
          <p className="muted small">{t('more.jevCustomOnlyHint')}</p>
        </div>
      ) : null}

      {settings.activePoints.length > 0 ? (
        <p className="muted small">
          {t('more.jevActiveNow', { points: settings.activePoints.join(', ') })}
        </p>
      ) : null}

      {msg ? <p className="muted small">{msg}</p> : null}
      {err ? <p className="muted small">{err}</p> : null}
    </div>
  );
}
