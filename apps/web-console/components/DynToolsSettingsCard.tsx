'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface DynToolSettings {
  enabled: boolean;
  allowPropose: boolean;
  allowSave: boolean;
  allowProjectPromote: boolean;
  hydrateTopK: number;
  unusedSuggestTurns: number;
  updatedAt: string;
}

interface SettingsResponse {
  settings: DynToolSettings;
  effective: { enabled: boolean; source: string };
}

interface DynToolRow {
  name: string;
  description: string;
  scope: string;
  status: string;
}

export function DynToolsSettingsCard({ sessionId }: { sessionId?: string }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<DynToolSettings | null>(null);
  const [effective, setEffective] = useState<SettingsResponse['effective'] | null>(null);
  const [tools, setTools] = useState<DynToolRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setErr(null);
    try {
      const data = (await api('/api/dyn-tools/settings')) as SettingsResponse;
      setSettings(data.settings);
      setEffective(data.effective);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadTools = useCallback(async () => {
    if (!sessionId) {
      setTools([]);
      return;
    }
    try {
      const data = (await api(`/api/sessions/${sessionId}/dyn-tools`)) as { tools?: DynToolRow[] };
      setTools(Array.isArray(data.tools) ? data.tools : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [sessionId]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    void loadTools();
  }, [loadTools]);

  const save = async (patch: Partial<DynToolSettings>) => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const data = (await api('/api/dyn-tools/settings', {
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

  const act = async (name: string, action: 'retire' | 'promote', targetScope?: string) => {
    if (!sessionId) return;
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const path =
        action === 'retire'
          ? `/api/sessions/${sessionId}/dyn-tools/${encodeURIComponent(name)}/retire`
          : `/api/sessions/${sessionId}/dyn-tools/${encodeURIComponent(name)}/promote`;
      const data = (await api(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: action === 'promote' ? JSON.stringify({ targetScope }) : '{}'
      })) as { pending?: boolean };
      if (data.pending) setMsg(t('more.dynToolsPromotePending'));
      else setMsg(t('more.savedNoRestart'));
      await loadTools();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!settings) {
    return (
      <div className="card" id="card-dyn-tools">
        <div className="card-head">
          <h3>{t('more.dynToolsTitle')}</h3>
        </div>
        <div className="empty-hint">{err ?? t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className="card" id="card-dyn-tools">
      <div className="card-head">
        <h3>{t('more.dynToolsTitle')}</h3>
        <span className="badge">{effective?.source === 'ui' ? t('more.sourceUi') : t('more.sourceDefault')}</span>
      </div>
      <p className="muted" style={{ fontSize: '0.8rem', marginTop: 0 }}>
        {t('more.dynToolsDesc')}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={busy}
            onChange={(e) => void save({ enabled: e.target.checked })}
          />
          <span>{t('more.dynToolsEnable')}</span>
          <span className="muted" style={{ fontSize: '0.75rem' }}>
            {t('more.effectivePrefix')}
            {effective?.enabled ? t('more.on') : t('more.off')}
          </span>
        </label>
        <label className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={settings.allowSave}
            disabled={busy || !settings.enabled}
            onChange={(e) => void save({ allowSave: e.target.checked })}
          />
          <span>{t('more.dynToolsAllowSave')}</span>
        </label>
        <label className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={settings.allowPropose}
            disabled={busy || !settings.enabled}
            onChange={(e) => void save({ allowPropose: e.target.checked })}
          />
          <span>{t('more.dynToolsAllowPropose')}</span>
        </label>
        <label className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={settings.allowProjectPromote}
            disabled={busy || !settings.enabled}
            onChange={(e) => void save({ allowProjectPromote: e.target.checked })}
          />
          <span>{t('more.dynToolsAllowPromote')}</span>
        </label>
        <label className="field">
          <span>{t('more.dynToolsHydrateTopK')}</span>
          <input
            type="number"
            min={1}
            max={20}
            value={settings.hydrateTopK}
            disabled={busy || !settings.enabled}
            onBlur={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n !== settings.hydrateTopK) void save({ hydrateTopK: n });
            }}
            onChange={(e) =>
              setSettings({ ...settings, hydrateTopK: Number(e.target.value) || settings.hydrateTopK })
            }
          />
        </label>
        <label className="field">
          <span>{t('more.dynToolsUnusedSuggestTurns')}</span>
          <input
            type="number"
            min={1}
            max={10000}
            value={settings.unusedSuggestTurns}
            disabled={busy || !settings.enabled}
            onBlur={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n !== settings.unusedSuggestTurns) {
                void save({ unusedSuggestTurns: n });
              }
            }}
            onChange={(e) =>
              setSettings({
                ...settings,
                unusedSuggestTurns: Number(e.target.value) || settings.unusedSuggestTurns
              })
            }
          />
        </label>
        <div className="card-head" style={{ paddingLeft: 0 }}>
          <h4 style={{ margin: 0 }}>{t('more.dynToolsSessionTitle')}</h4>
        </div>
        {!sessionId ? (
          <div className="empty-hint">{t('more.dynToolsNoSession')}</div>
        ) : !tools.length ? (
          <div className="empty-hint">{t('more.dynToolsEmpty')}</div>
        ) : (
          tools.map((row) => (
            <div key={row.name} className="list-item">
              <div className="row">
                <strong>{row.name}</strong>
              </div>
              <div className="muted" style={{ fontSize: '0.75rem' }}>
                {t('more.dynToolsStatus', { status: row.status, scope: row.scope })}
              </div>
              {row.description ? (
                <div className="muted" style={{ fontSize: '0.75rem' }}>
                  {row.description}
                </div>
              ) : null}
              {row.status !== 'retired' ? (
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => void act(row.name, 'retire')}
                  >
                    {t('more.dynToolsRetire')}
                  </button>
                  {row.scope === 'session.scratch' ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => void act(row.name, 'promote', 'session.long')}
                    >
                      {t('more.dynToolsPromoteLong')}
                    </button>
                  ) : null}
                  {row.scope !== 'project.memory' ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy || !settings.allowProjectPromote}
                      onClick={() => void act(row.name, 'promote', 'project.memory')}
                    >
                      {t('more.dynToolsPromoteProject')}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))
        )}
        {msg ? <div className="muted" style={{ fontSize: '0.8rem' }}>{msg}</div> : null}
        {err ? <div style={{ color: 'var(--danger, #c44)', fontSize: '0.8rem' }}>{err}</div> : null}
      </div>
    </div>
  );
}
