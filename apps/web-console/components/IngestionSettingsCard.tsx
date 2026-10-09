'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { SettingsGroup } from './ui';
import styles from './sections/knowledge/knowledge.module.css';

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
      setMsg(t('knowledge.ingestion.saved'));
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
      setMsg(t('knowledge.ingestion.browserSaved'));
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
      setMsg(t('knowledge.ingestion.webSearchSaved'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!ing) {
    return (
      <SettingsGroup title={t('knowledge.ingestion.title')} description={t('knowledge.ingestion.desc')}>
        {err ? (
          <p role="alert" className={styles.error}>
            {t('knowledge.ingestion.loadFailed', { error: err })}
          </p>
        ) : (
          <p className="muted">{t('common.loading')}</p>
        )}
      </SettingsGroup>
    );
  }

  const fromUi = ingSource === 'ui' || browserSource === 'ui' || webSource === 'ui';

  return (
    <>
      <SettingsGroup title={t('knowledge.ingestion.title')} description={t('knowledge.ingestion.desc')}>
        <label className={styles.toggleRow}>
          <input
            id="ingestionEnabled"
            type="checkbox"
            checked={ing.enabled}
            disabled={busy}
            onChange={(e) => void saveIng({ enabled: e.target.checked })}
          />
          <span>
            <span className={styles.toggleTitle}>{t('knowledge.ingestion.enabled')}</span>
            <span className={styles.toggleDesc}>{t('knowledge.ingestion.enabledDesc')}</span>
          </span>
        </label>
        <label className={styles.toggleRow}>
          <input
            id="ingestionBrowser"
            type="checkbox"
            checked={Boolean(browser?.enabled)}
            disabled={busy}
            onChange={(e) => void saveBrowser(e.target.checked)}
          />
          <span>
            <span className={styles.toggleTitle}>{t('knowledge.ingestion.browser')}</span>
            <span className={styles.toggleDesc}>{t('knowledge.ingestion.browserDesc')}</span>
          </span>
        </label>
        <div className={styles.actions}>
          <span className="badge">{fromUi ? t('knowledge.sourceUi') : t('knowledge.sourceDefault')}</span>
        </div>
      </SettingsGroup>

      <SettingsGroup advanced title={t('knowledge.ingestion.advancedTitle')} description={t('knowledge.ingestion.advancedDesc')}>
        <label className={styles.toggleRow}>
          <input
            id="ingestionGbk"
            type="checkbox"
            checked={ing.gbkFallback}
            disabled={busy}
            onChange={(e) => void saveIng({ gbkFallback: e.target.checked })}
          />
          <span>
            <span className={styles.toggleTitle}>{t('knowledge.ingestion.gbk')}</span>
            <span className={styles.toggleDesc}>{t('knowledge.ingestion.gbkDesc')}</span>
          </span>
        </label>
        <label className={styles.field} htmlFor="web-search-url">
          <span>{t('knowledge.ingestion.webSearchUrl')}</span>
          <input
            id="web-search-url"
            className="input"
            type="text"
            value={searchUrlDraft}
            disabled={busy || !web}
            placeholder={t('knowledge.ingestion.webSearchPh')}
            onChange={(e) => setSearchUrlDraft(e.target.value)}
          />
          <small className="muted">{t('knowledge.ingestion.webSearchHint')}</small>
        </label>
        <div className={styles.actions}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy || !web} onClick={() => void saveWeb(searchUrlDraft)}>
            {t('knowledge.ingestion.webSearchSave')}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy || !web || !searchUrlDraft}
            onClick={() => void saveWeb('')}
          >
            {t('knowledge.ingestion.webSearchClear')}
          </button>
        </div>
      </SettingsGroup>

      {msg ? (
        <p role="status" className="muted">
          {msg}
        </p>
      ) : null}
      {err ? (
        <p role="alert" className={styles.error}>
          {err}
        </p>
      ) : null}
    </>
  );
}
