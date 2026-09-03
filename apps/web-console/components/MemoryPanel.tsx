'use client';

import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useCallback, useEffect, useState } from 'react';

export type MemoryEntryRow = {
  id: string;
  scope: string;
  key: string;
  value: string;
};

type CuratorMode = 'inline' | 'observe_only' | 'off';

type MemorySettings = {
  curatorMode: CuratorMode;
  dialogueExtract: boolean;
  dreamerEnabled: boolean;
  compilerEnabled: boolean;
  embeddingRecall: boolean;
  minTaskTools: number;
  updatedAt: string;
};

type ObservationRow = {
  id: string;
  kind: string;
  gate: string;
  gateReason?: string;
  taskContent?: string;
  createdAt: string;
};

type PreviewSection = {
  id: string;
  title: string;
  text: string;
  chars: number;
  capped: boolean;
};

export function MemoryPanel() {
  const { t } = useI18n();
  const [scope, setScope] = useState('session.scratch');
  const [rows, setRows] = useState<MemoryEntryRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<MemorySettings | null>(null);
  const [source, setSource] = useState<string>('default');
  const [obs, setObs] = useState<ObservationRow[]>([]);
  const [query, setQuery] = useState('');
  const [userId, setUserId] = useState('local');
  const [sections, setSections] = useState<PreviewSection[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    const data = (await api('/api/memory/settings')) as { settings: MemorySettings; source?: string };
    setSettings(data.settings);
    setSource(data.source ?? 'default');
  }, []);

  const loadObs = useCallback(async () => {
    const data = (await api('/api/memory/observations?limit=12')) as { observations?: ObservationRow[] };
    setObs(data.observations ?? []);
  }, []);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const q = new URLSearchParams({ scope, limit: '50' });
      const res = (await api(`/api/memory?${q}`)) as { entries?: MemoryEntryRow[]; items?: MemoryEntryRow[] };
      setRows(res.entries ?? res.items ?? []);
      await loadSettings();
      await loadObs();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [scope, loadSettings, loadObs]);

  useEffect(() => {
    void loadSettings();
    void loadObs();
  }, [loadSettings, loadObs]);

  const save = async (patch: Partial<MemorySettings>) => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const data = (await api('/api/memory/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      })) as { settings: MemorySettings; source?: string };
      setSettings(data.settings);
      setSource(data.source ?? 'ui');
      setMsg(t('common.saved'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const preview = async () => {
    setBusy(true);
    setErr(null);
    try {
      const data = (await api('/api/memory/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, userId })
      })) as { pack?: { sections?: PreviewSection[] } };
      setSections(data.pack?.sections ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ gridColumn: '1 / -1' }}>
      <div className="card-head">
        <h3>{t('memory.title')}</h3>
        <span className="badge">{source === 'ui' ? t('memory.sourceUi') : t('memory.sourceDefault')}</span>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void load()}>
          {t('memory.query')}
        </button>
      </div>
      <p className="muted" style={{ fontSize: '0.8rem', margin: '0 0.75rem 0.5rem' }}>
        {t('memory.hint')}
      </p>
      {settings ? (
        <div style={{ padding: '0 0.75rem 0.5rem', display: 'grid', gap: '0.4rem' }}>
          <label className="field field--inline">
            <span>{t('memory.curator')}</span>
            <select
              className="input"
              disabled={busy}
              value={settings.curatorMode}
              onChange={(e) => void save({ curatorMode: e.target.value as CuratorMode })}
            >
              <option value="inline">{t('memory.curatorInline')}</option>
              <option value="observe_only">{t('memory.curatorObserveOnly')}</option>
              <option value="off">{t('memory.curatorOff')}</option>
            </select>
          </label>
          <label className="field field--inline">
            <span>{t('memory.dialogueExtract')}</span>
            <input
              type="checkbox"
              disabled={busy}
              checked={settings.dialogueExtract}
              onChange={(e) => void save({ dialogueExtract: e.target.checked })}
            />
          </label>
          <label className="field field--inline">
            <span>{t('memory.dreamer')}</span>
            <input
              type="checkbox"
              disabled={busy}
              checked={settings.dreamerEnabled}
              onChange={(e) => void save({ dreamerEnabled: e.target.checked })}
            />
          </label>
          <label className="field field--inline">
            <span>{t('memory.compiler')}</span>
            <input
              type="checkbox"
              disabled={busy}
              checked={settings.compilerEnabled}
              onChange={(e) => void save({ compilerEnabled: e.target.checked })}
            />
          </label>
          <label className="field field--inline">
            <span>{t('memory.embeddingRecall')}</span>
            <input
              type="checkbox"
              disabled={busy}
              checked={Boolean(settings.embeddingRecall)}
              onChange={(e) => void save({ embeddingRecall: e.target.checked })}
            />
          </label>
          <p className="muted" style={{ fontSize: '0.75rem', margin: 0 }}>
            {t('memory.embeddingHint')}
          </p>
        </div>
      ) : null}

      <div style={{ padding: '0 0.75rem 0.5rem' }}>
        <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>
          {t('memory.recentObs')}
        </div>
        <div className="list-scroll" style={{ maxHeight: '6rem' }}>
          {!obs.length ? (
            <div className="empty-hint">{t('memory.emptyObs')}</div>
          ) : (
            obs.map((o) => (
              <div key={o.id} className="list-item">
                <div className="row">
                  <strong>{o.gate}</strong>
                  <span className="muted">{o.kind}</span>
                </div>
                <div className="muted" style={{ fontSize: '0.75rem' }}>
                  {o.gateReason ?? ''} {o.taskContent ? `· ${o.taskContent.slice(0, 60)}` : ''}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div style={{ padding: '0 0.75rem 0.5rem', display: 'grid', gap: 6 }}>
        <input
          className="input"
          placeholder={t('memory.previewQueryPh')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <input
          className="input"
          placeholder={t('memory.userIdPh')}
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        />
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void preview()}>
          {t('memory.previewSlots')}
        </button>
        {sections.length === 0 ? (
          <div className="empty-hint">{t('memory.emptyPreview')}</div>
        ) : (
          sections.map((s) => (
            <div key={s.id} className="list-item">
              <div className="row">
                <strong>{s.title}</strong>
                <span className="muted">{t('memory.sectionChars', { n: s.chars })}</span>
              </div>
              <pre className="muted" style={{ fontSize: '0.75rem', whiteSpace: 'pre-wrap', margin: 0 }}>
                {s.text.slice(0, 400)}
              </pre>
            </div>
          ))
        )}
      </div>

      <div style={{ padding: '0.5rem 0.75rem' }}>
        <select className="input" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="session.scratch">session.scratch</option>
          <option value="session.long">session.long</option>
          <option value="user.memory">user.memory</option>
          <option value="team.memory">team.memory</option>
          <option value="project.memory">project.memory</option>
        </select>
      </div>
      <div className="list-scroll" style={{ maxHeight: '10rem' }}>
        {!rows.length ? (
          <div className="empty-hint">{t('memory.emptyEntries')}</div>
        ) : (
          rows.map((r) => (
            <div key={r.id} className="list-item">
              <div className="row">
                <strong>{r.key}</strong>
                <span className="muted">{r.scope}</span>
              </div>
              <div className="muted" style={{ fontSize: '0.75rem' }}>
                {String(r.value).slice(0, 120)}
              </div>
            </div>
          ))
        )}
      </div>
      {msg ? <div className="muted" style={{ fontSize: '0.8rem', padding: '0 0.75rem 0.5rem' }}>{msg}</div> : null}
      {err ? <div style={{ color: 'var(--danger, #c44)', fontSize: '0.8rem', padding: '0 0.75rem 0.5rem' }}>{err}</div> : null}
    </div>
  );
}
