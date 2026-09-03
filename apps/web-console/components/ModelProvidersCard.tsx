'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { ModelProvidersResponse, PublicModelProvider } from '@/lib/model-providers';
import { ModelSetupForm } from './ModelSetupForm';

export type ModelProvidersCardProps = {
  onCatalogChange?: (data: ModelProvidersResponse) => void;
  heading?: string;
};

export function ModelProvidersCard({ onCatalogChange, heading }: ModelProvidersCardProps) {
  const { t } = useI18n();
  const [data, setData] = useState<ModelProvidersResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBaseUrl, setEditBaseUrl] = useState('');
  const [editApiKey, setEditApiKey] = useState('');
  const [modelQuery, setModelQuery] = useState('');
  const [addDraft, setAddDraft] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const autoOpenedRef = useRef(false);
  const onCatalogChangeRef = useRef(onCatalogChange);
  onCatalogChangeRef.current = onCatalogChange;

  const apply = useCallback((next: ModelProvidersResponse) => {
    setData(next);
    onCatalogChangeRef.current?.(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = (await api('/api/model-providers')) as ModelProvidersResponse;
        if (!cancelled) apply(next);
      } catch {
        if (!cancelled) {
          setData(null);
          setErr(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const providers = data?.catalog.providers ?? [];
  const uiProviders = providers.filter((p) => p.source === 'ui');
  useEffect(() => {
    if (autoOpenedRef.current || !data) return;
    autoOpenedRef.current = true;
    if (uiProviders.length === 0) setAdding(true);
  }, [data, uiProviders.length]);
  const previewGroups = providers
    .map((p) => ({ provider: p, models: p.models.filter((m) => m.enabled) }))
    .filter((g) => g.provider.source === 'ui' || g.models.length > 0);

  const scan = async (id: string) => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const next = (await api(`/api/model-providers/${encodeURIComponent(id)}/scan`, {
        method: 'POST'
      })) as ModelProvidersResponse & { ok?: boolean; error?: string; scanned?: number };
      apply(next);
      if (next.ok === false) {
        setErr(next.error || t('more.scanFailed'));
      } else {
        setMsg(t('more.scanned', { count: next.scanned ?? 0 }));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const next = (await api(`/api/model-providers/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      })) as ModelProvidersResponse;
      apply(next);
      setMsg(t('more.deleted'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setDefault = async (providerId: string, modelId: string) => {
    setBusy(true);
    setErr(null);
    try {
      const next = (await api('/api/model-providers/default', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultRef: { providerId, modelId } })
      })) as ModelProvidersResponse;
      apply(next);
      setMsg(t('more.setDefaultMsg', { model: modelId }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addModel = async (provider: PublicModelProvider, rawId: string) => {
    const modelId = rawId.trim();
    if (!modelId) {
      setErr(t('more.fillModelId'));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const exists = provider.models.some((m) => m.id === modelId);
      const models = exists
        ? provider.models.map((m) => (m.id === modelId ? { ...m, enabled: true } : m))
        : [...provider.models, { id: modelId, enabled: true }];
      const next = (await api(`/api/model-providers/${encodeURIComponent(provider.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ models })
      })) as ModelProvidersResponse;
      apply(next);
      setAddDraft((cur) => ({ ...cur, [provider.id]: '' }));
      setMsg(t('more.addedModel', { model: modelId }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleModel = async (provider: PublicModelProvider, modelId: string, enabled: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      const models = provider.models.map((m) => (m.id === modelId ? { ...m, enabled } : m));
      const next = (await api(`/api/model-providers/${encodeURIComponent(provider.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ models })
      })) as ModelProvidersResponse;
      apply(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (id: string) => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const patch: Record<string, string> = {};
      if (editBaseUrl.trim()) patch.baseUrl = editBaseUrl.trim();
      if (editApiKey.trim()) patch.apiKey = editApiKey.trim();
      if (!Object.keys(patch).length) {
        setErr(t('more.fillUrlOrKey'));
        return;
      }
      const next = (await api(`/api/model-providers/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      })) as ModelProvidersResponse;
      apply(next);
      setEditApiKey('');
      setEditingId(null);
      await scan(id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h3>{heading ?? t('more.modelProvidersTitle')}</h3>
        <span className="badge">{uiProviders.length}</span>
      </div>
      <p className="muted" style={{ fontSize: '0.8rem', margin: '0 0 8px' }}>
        {t('more.modelProvidersDesc')}
        {data?.effective.source === 'env' ? t('more.modelProvidersEnvFallback') : null}
      </p>
      {err && err !== 'Failed to fetch' ? <p className="muted err">{err}</p> : null}
      {msg ? <p className="muted ok">{msg}</p> : null}

      <div className="model-add-bar">
        <button
          type="button"
          className={`btn btn-sm${adding ? ' btn-ghost' : ' btn-primary'}`}
          onClick={() => setAdding((v) => !v)}
        >
          {adding ? t('more.collapseAdd') : t('more.addProvider')}
        </button>
        <span className="muted" style={{ fontSize: '0.75rem' }}>
          {t('more.customCount', { count: uiProviders.length })}
        </span>
      </div>
      {adding ? (
        <div className="model-add-panel">
          <ModelSetupForm
            providers={providers}
            defaultRef={data?.catalog.defaultRef}
            onSaved={(next) => {
              apply(next);
              const label = next.provider?.name?.trim();
              setMsg(label ? t('more.addedProviderNamed', { label }) : t('more.addedProvider'));
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      ) : null}

      {previewGroups.length ? (
        <section className="model-enabled-preview" aria-label={t('more.availableModelsAria')}>
          <h4 className="model-enabled-preview__title">{t('more.availableModelsTitle')}</h4>
          <p className="muted model-enabled-preview__hint">
            {t('more.availableModelsHint')}
          </p>
          <div className="model-enabled-preview__groups">
            {previewGroups.map(({ provider, models }) => (
              <div key={provider.id} className="model-enabled-preview__group">
                <div className="model-enabled-preview__provider">
                  {provider.name}
                  {provider.source === 'ui' ? <span className="muted">{t('more.customSuffix')}</span> : null}
                </div>
                {models.length ? (
                  <ul>
                    {models.map((m) => (
                      <li key={m.id}>
                        <code>{m.id}</code>
                        {data?.catalog.defaultRef?.providerId === provider.id &&
                        data.catalog.defaultRef.modelId === m.id ? (
                          <span className="muted">{t('more.defaultSuffix')}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted" style={{ fontSize: '0.75rem', margin: 0 }}>
                    {t('more.noModelsYet')}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : (
        <p className="muted" style={{ fontSize: '0.8rem', margin: '8px 0 0' }}>
          {t('more.noProviders')}
        </p>
      )}

      <div className="list-scroll" style={{ marginTop: 12, maxHeight: 360 }}>
        {!providers.length ? (
          <div className="empty-hint">{t('more.noProviders')}</div>
        ) : (
          providers.map((p) => {
            const q = modelQuery.trim().toLowerCase();
            const models = q
              ? p.models.filter(
                  (m) => m.id.toLowerCase().includes(q) || (m.ownedBy ?? '').toLowerCase().includes(q)
                )
              : p.models;
            return (
              <div key={p.id} className="list-item" style={{ cursor: 'default' }}>
                <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                  <strong>{p.name}</strong>
                  <span className="muted" style={{ fontSize: '0.75rem' }}>
                    {p.kind} · {p.apiKeyMasked || t('more.noKey')}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: '0.75rem' }}>
                  {p.baseUrl || '—'}
                  {p.scannedAt ? t('more.scannedAt', { at: p.scannedAt.slice(0, 19).replace('T', ' ') }) : ''}
                </div>
                {p.scanError ? (
                  <div className="muted err" style={{ fontSize: '0.75rem' }}>
                    {p.scanError}
                  </div>
                ) : null}
                {p.source === 'ui' ? (
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {p.kind !== 'heuristic' ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busy}
                      onClick={() => void scan(p.id)}
                    >
                      {t('more.rediscover')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => {
                      setEditingId(editingId === p.id ? null : p.id);
                      setEditBaseUrl(p.baseUrl);
                      setEditApiKey('');
                    }}
                  >
                    {editingId === p.id ? t('more.cancelEdit') : t('more.editUrlKey')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => void remove(p.id)}
                  >
                    {t('more.delete')}
                  </button>
                </div>
                ) : (
                  <div className="muted" style={{ fontSize: '0.75rem', marginTop: 6 }}>
                    {p.source === 'env' ? t('more.fromEnv') : t('more.builtin')}
                  </div>
                )}
                {editingId === p.id ? (
                  <div className="row-3" style={{ marginTop: 8 }}>
                    <label className="field">
                      <span>Base URL</span>
                      <input
                        value={editBaseUrl}
                        onChange={(e) => setEditBaseUrl(e.target.value)}
                        autoComplete="off"
                      />
                    </label>
                    <label className="field">
                      <span>API Key</span>
                      <input
                        type="password"
                        value={editApiKey}
                        onChange={(e) => setEditApiKey(e.target.value)}
                        placeholder={t('more.apiKeyKeep')}
                        autoComplete="off"
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={busy}
                      onClick={() => void saveEdit(p.id)}
                    >
                      {t('more.saveAndRediscover')}
                    </button>
                  </div>
                ) : null}
                {p.source === 'ui' ? (
                  <div className="model-add-row">
                    <label className="field" style={{ flex: 1, minWidth: 160, marginTop: 8 }}>
                      <span>{t('more.addModelId')}</span>
                      <input
                        value={addDraft[p.id] ?? ''}
                        onChange={(e) => setAddDraft((cur) => ({ ...cur, [p.id]: e.target.value }))}
                        placeholder={t('more.addModelPlaceholder')}
                        autoComplete="off"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void addModel(p, addDraft[p.id] ?? '');
                          }
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busy || !(addDraft[p.id] ?? '').trim()}
                      onClick={() => void addModel(p, addDraft[p.id] ?? '')}
                    >
                      {t('more.add')}
                    </button>
                  </div>
                ) : null}
                {p.models.length ? (
                  <>
                    {p.models.length > 8 ? (
                      <label className="field" style={{ marginTop: 8 }}>
                        <span>{t('more.filterModels')}</span>
                        <input
                          value={modelQuery}
                          onChange={(e) => setModelQuery(e.target.value)}
                          placeholder={t('more.searchModels')}
                          autoComplete="off"
                        />
                      </label>
                    ) : null}
                    <ul className="model-scan-list">
                      {models.map((m) => (
                        <li key={m.id}>
                          <label className="toggle">
                            <input
                              type="checkbox"
                              checked={m.enabled}
                              disabled={busy || p.source !== 'ui'}
                              onChange={(e) => void toggleModel(p, m.id, e.target.checked)}
                            />
                            <span>
                              <code>{m.id}</code>
                              {m.ownedBy ? <span className="muted"> · {m.ownedBy}</span> : null}
                            </span>
                          </label>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busy || !m.enabled}
                            onClick={() => void setDefault(p.id, m.id)}
                          >
                            {t('more.sourceDefault')}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <div className="muted" style={{ fontSize: '0.75rem', marginTop: 6 }}>
                    {t('more.noModelsFound')}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
