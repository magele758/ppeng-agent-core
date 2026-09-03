'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface EventLogSettings {
  enabled: boolean;
  updatedAt: string;
}

export function EventLogSettingsCard() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<EventLogSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const data = (await api('/api/event-log/settings')) as { settings: EventLogSettings };
      setSettings(data.settings);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (enabled: boolean) => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const data = (await api('/api/event-log/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      })) as { settings: EventLogSettings };
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
        <h3>{t('more.eventLogTitle')}</h3>
        {err ? <p className="muted">{err}</p> : <p className="muted">{t('more.loadingSettings')}</p>}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h3>{t('more.eventLogTitle')}</h3>
      </div>
      <p className="muted small">
        {t('more.eventLogDesc')}
      </p>
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.enabled}
          disabled={busy}
          onChange={(e) => void save(e.target.checked)}
        />
        <span>{t('more.eventLogToggle')}</span>
      </label>
      {msg ? <p className="muted small">{msg}</p> : null}
      {err ? <p className="muted">{err}</p> : null}
    </div>
  );
}
