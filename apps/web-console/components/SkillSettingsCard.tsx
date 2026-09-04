'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n, type MessageKey } from '@/lib/i18n';

export type SkillDisclosureMode = 'shortlist' | 'lazy' | 'full';

interface SkillSettings {
  disclosureMode: SkillDisclosureMode;
  updatedAt: string;
}

interface SettingsResponse {
  settings: SkillSettings;
  effective: {
    disclosureMode: SkillDisclosureMode;
    source: string;
  };
}

function hintKey(mode: SkillDisclosureMode): MessageKey {
  switch (mode) {
    case 'lazy':
      return 'more.skillHintLazy';
    case 'full':
      return 'more.skillHintFull';
    case 'shortlist':
      return 'more.skillHintShortlist';
    default: {
      const _never: never = mode;
      return _never;
    }
  }
}

export function SkillSettingsCard() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<SkillSettings | null>(null);
  const [effective, setEffective] = useState<SettingsResponse['effective'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const data = (await api('/api/skills/settings')) as SettingsResponse;
      setSettings(data.settings);
      setEffective(data.effective);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (patch: Partial<SkillSettings>) => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const data = (await api('/api/skills/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      })) as SettingsResponse;
      setSettings(data.settings);
      setEffective(data.effective);
      setMsg(t('more.savedNoRestart'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!settings) {
    return (
      <div className="card">
        <div className="card-head">
          <h3>{t('more.skillTitle')}</h3>
        </div>
        <p className="muted">{err ?? t('more.loadingSettings')}</p>
      </div>
    );
  }

  const mode = effective?.disclosureMode ?? settings.disclosureMode;

  return (
    <div className="card" id="card-skill-disclosure">
      <div className="card-head">
        <h3>{t('more.skillTitle')}</h3>
        <span className="badge">{effective?.source === 'ui' ? t('more.sourceUi') : t('more.sourceDefault')}</span>
      </div>
      <p className="muted" style={{ fontSize: '0.8rem', marginTop: 0 }}>
        {t('more.skillDesc')}
      </p>
      <label className="field">
        <span>{t('more.skillDisclosureLabel')}</span>
        <select
          disabled={busy}
          value={mode}
          aria-label={t('more.skillDisclosureAria')}
          onChange={(e) => void save({ disclosureMode: e.target.value as SkillDisclosureMode })}
        >
          <option value="shortlist">{t('more.skillDisclosureShortlist')}</option>
          <option value="lazy">{t('more.skillDisclosureLazy')}</option>
          <option value="full">{t('more.skillDisclosureFull')}</option>
        </select>
      </label>
      <p className="muted" style={{ fontSize: '0.75rem' }}>
        {t(hintKey(mode))}
      </p>
      {msg ? <div className="muted" style={{ fontSize: '0.8rem' }}>{msg}</div> : null}
      {err ? <div style={{ color: 'var(--danger, #c44)', fontSize: '0.8rem' }}>{err}</div> : null}
    </div>
  );
}
