'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface GoalSettings {
  entityEnabled: boolean;
  defaultMaxTurns: number;
  allowHttpVerify: boolean;
  allowCommandVerify: boolean;
  updatedAt: string;
}

export function GoalSettingsCard() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<GoalSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const data = (await api('/api/goals/settings')) as { settings: GoalSettings };
      setSettings(data.settings);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (patch: Partial<GoalSettings>) => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const data = (await api('/api/goals/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      })) as { settings: GoalSettings };
      setSettings(data.settings);
      setMsg(t('common.saved'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!settings) {
    return (
      <div className="card">
        <h3>{t('more.goalLoadingTitle')}</h3>
        {err ? <p className="muted">{err}</p> : <p className="muted">{t('more.loadingSettings')}</p>}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h3>{t('more.goalTitle')}</h3>
      </div>
      <p className="muted small">{t('more.goalDesc')}</p>
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.entityEnabled}
          disabled={busy}
          onChange={(e) => void save({ entityEnabled: e.target.checked })}
        />
        <span>{t('more.goalEnable')}</span>
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.allowHttpVerify}
          disabled={busy}
          onChange={(e) => void save({ allowHttpVerify: e.target.checked })}
        />
        <span>{t('more.goalHttpVerify')}</span>
      </label>
      <label className="field">
        <span>{t('more.goalMaxTurns')}</span>
        <input
          type="number"
          min={1}
          max={100}
          value={settings.defaultMaxTurns}
          disabled={busy}
          onBlur={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n !== settings.defaultMaxTurns) void save({ defaultMaxTurns: n });
          }}
          onChange={(e) =>
            setSettings({ ...settings, defaultMaxTurns: Number(e.target.value) || settings.defaultMaxTurns })
          }
        />
      </label>
      {msg ? <p className="muted small">{msg}</p> : null}
      {err ? <p className="muted small">{err}</p> : null}
    </div>
  );
}
