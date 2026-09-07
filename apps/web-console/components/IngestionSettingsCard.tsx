'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface IngestionSettings {
  enabled: boolean;
  gbkFallback: boolean;
  updatedAt: string;
}

interface BrowserSettings {
  enabled: boolean;
  updatedAt: string;
}

interface WebSettings {
  searchUrl: string;
  updatedAt: string;
}

export function IngestionSettingsCard() {
  const { t } = useI18n();
  const [ing, setIng] = useState<IngestionSettings | null>(null);
  const [browser, setBrowser] = useState<BrowserSettings | null>(null);
  const [web, setWeb] = useState<WebSettings | null>(null);
  const [searchUrlDraft, setSearchUrlDraft] = useState('');
  const [ingSource, setIngSource] = useState<string>('default');
  const [browserSource, setBrowserSource] = useState<string>('env_or_default');
  const [webSource, setWebSource] = useState<string>('default');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [i, b, w] = await Promise.all([
        api('/api/ingestion/settings') as Promise<{
          settings: IngestionSettings;
          effective?: { source?: string };
        }>,
        api('/api/browser/settings') as Promise<{
          settings: BrowserSettings;
          effective?: { source?: string };
        }>,
        api('/api/web/settings') as Promise<{
          settings: WebSettings;
          effective?: { source?: string; searchUrl?: string };
        }>
      ]);
      setIng(i.settings);
      setIngSource(i.effective?.source ?? 'default');
      setBrowser(b.settings);
      setBrowserSource(b.effective?.source ?? 'env_or_default');
      setWeb(w.settings);
      setWebSource(w.effective?.source ?? 'default');
      setSearchUrlDraft(w.effective?.searchUrl ?? w.settings.searchUrl ?? '');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveIng = async (patch: Partial<IngestionSettings>) => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const data = (await api('/api/ingestion/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      })) as { settings: IngestionSettings; effective?: { source?: string } };
      setIng(data.settings);
      setIngSource(data.effective?.source ?? 'ui');
      setMsg(t('more.ingestionSaved'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveBrowser = async (enabled: boolean) => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const data = (await api('/api/browser/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      })) as { settings: BrowserSettings; effective?: { source?: string } };
      setBrowser(data.settings);
      setBrowserSource(data.effective?.source ?? 'ui');
      setMsg(t('more.browserSaved'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveWeb = async (searchUrl: string) => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const data = (await api('/api/web/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchUrl })
      })) as { settings: WebSettings; effective?: { source?: string; searchUrl?: string } };
      setWeb(data.settings);
      setWebSource(data.effective?.source ?? 'ui');
      setSearchUrlDraft(data.effective?.searchUrl ?? data.settings.searchUrl ?? '');
      setMsg(t('more.webSearchSaved'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!ing) {
    return (
      <div className="card">
        <div className="card-head">
          <h3>{t('more.ingestionTitle')}</h3>
        </div>
        {err ? <p className="muted">{err}</p> : <p className="muted">{t('common.loading')}</p>}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h3>{t('more.ingestionTitle')}</h3>
        <span className="badge">{ingSource === 'ui' || browserSource === 'ui' || webSource === 'ui' ? t('more.sourceUi') : t('more.sourceDefault')}</span>
      </div>
      <p className="muted" style={{ fontSize: '0.8rem', marginTop: 0 }}>
        {t('more.ingestionDesc')}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={ing.enabled}
            disabled={busy}
            onChange={(e) => void saveIng({ enabled: e.target.checked })}
          />
          <span>{t('more.ingestionEnable')}</span>
        </label>
        <label className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={ing.gbkFallback}
            disabled={busy}
            onChange={(e) => void saveIng({ gbkFallback: e.target.checked })}
          />
          <span>{t('more.ingestionGbk')}</span>
        </label>
        <label className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={Boolean(browser?.enabled)}
            disabled={busy}
            onChange={(e) => void saveBrowser(e.target.checked)}
          />
          <span>{t('more.ingestionBrowser')}</span>
        </label>
        <label className="muted" style={{ fontSize: '0.8rem' }} htmlFor="web-search-url">
          {t('more.webSearchUrl')}
        </label>
        <p className="muted" style={{ fontSize: '0.75rem', margin: 0 }}>
          {t('more.webSearchHint')}
        </p>
        <input
          id="web-search-url"
          type="text"
          value={searchUrlDraft}
          disabled={busy || !web}
          placeholder={t('more.webSearchPlaceholder')}
          onChange={(e) => setSearchUrlDraft(e.target.value)}
        />
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy || !web}
            onClick={() => void saveWeb(searchUrlDraft)}
          >
            {t('more.webSearchSave')}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy || !web || !searchUrlDraft}
            onClick={() => void saveWeb('')}
          >
            {t('more.webSearchClear')}
          </button>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void load()}>
            {t('common.refresh')}
          </button>
        </div>
        {msg ? <div className="muted" style={{ fontSize: '0.8rem' }}>{msg}</div> : null}
        {err ? <div style={{ color: 'var(--danger, #c44)', fontSize: '0.8rem' }}>{err}</div> : null}
      </div>
    </div>
  );
}
