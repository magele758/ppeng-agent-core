'use client';

import { useI18n, type I18nContextValue } from '@/lib/i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type {
  ModelProviderKind,
  ModelProvidersResponse,
  ModelRef,
  PreviewScanResponse,
  PublicModelProvider,
  RemoteModelHint
} from '@/lib/model-providers';
import {
  MODEL_PROVIDER_PRESETS,
  baseUrlFromModelsEndpoint,
  matchProviderPresetId,
  providersForPresetRow
} from '@/lib/model-providers';

const KIND_IDS: ModelProviderKind[] = ['openai-compatible', 'anthropic-compatible'];

function kindLabel(id: ModelProviderKind, t: I18nContextValue['t']): string {
  switch (id) {
    case 'openai-compatible':
      return t('nav.kindOpenai');
    case 'anthropic-compatible':
      return t('nav.kindAnthropic');
    case 'heuristic':
      return t('nav.kindHeuristic');
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

export type ModelSetupFormProps = {
  onSaved: (data: ModelProvidersResponse & { provider?: PublicModelProvider }) => void;
  onCancel?: () => void;
  compact?: boolean;
  providers?: PublicModelProvider[];
  defaultRef?: ModelRef | null;
};

export function ModelSetupForm({ onSaved, onCancel, compact, providers = [], defaultRef }: ModelSetupFormProps) {
  const { t } = useI18n();
  const configured = useMemo(() => providersForPresetRow(providers), [providers]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [presetId, setPresetId] = useState('custom');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ModelProviderKind>('openai-compatible');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [savedKeyMasked, setSavedKeyMasked] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<RemoteModelHint[]>([]);
  const [enabledIds, setEnabledIds] = useState<string[]>([]);
  const [listQuery, setListQuery] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [comboOpen, setComboOpen] = useState(false);
  const comboRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = defaultModel.trim().toLowerCase();
    if (!q) return preview;
    return preview.filter(
      (m) => m.id.toLowerCase().includes(q) || (m.ownedBy ?? '').toLowerCase().includes(q)
    );
  }, [preview, defaultModel]);

  const listed = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    if (!q) return preview;
    return preview.filter(
      (m) => m.id.toLowerCase().includes(q) || (m.ownedBy ?? '').toLowerCase().includes(q)
    );
  }, [preview, listQuery]);

  const enabledSet = useMemo(() => new Set(enabledIds), [enabledIds]);

  useEffect(() => {
    if (!comboOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!comboRef.current?.contains(e.target as Node)) setComboOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setComboOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [comboOpen]);

  const clearDraftModels = () => {
    setPreview([]);
    setEnabledIds([]);
    setListQuery('');
    setDefaultModel('');
    setComboOpen(false);
    setErr(null);
    setMsg(null);
  };

  const applyPreset = (id: string) => {
    const preset = MODEL_PROVIDER_PRESETS.find((p) => p.id === id);
    setEditingId(null);
    setPresetId(id);
    if (!preset) return;
    setKind(preset.kind);
    setBaseUrl(preset.baseUrl);
    setName('');
    setSavedKeyMasked('');
    if (preset.apiKeyHint && !apiKey.trim()) setApiKey(preset.apiKeyHint);
    clearDraftModels();
  };

  const startNew = () => {
    setEditingId(null);
    setPresetId('custom');
    setKind('openai-compatible');
    setBaseUrl('');
    setName('');
    setApiKey('');
    setSavedKeyMasked('');
    clearDraftModels();
  };

  const loadConfigured = (provider: PublicModelProvider) => {
    setEditingId(provider.id);
    setPresetId(matchProviderPresetId(provider));
    setKind(provider.kind);
    setBaseUrl(provider.baseUrl);
    setName(provider.name);
    setApiKey('');
    setSavedKeyMasked(provider.hasApiKey ? provider.apiKeyMasked : '');
    const models = provider.models;
    setPreview(models.map((m) => ({ id: m.id, ownedBy: m.ownedBy })));
    setEnabledIds(models.filter((m) => m.enabled).map((m) => m.id));
    const preferred =
      defaultRef?.providerId === provider.id && models.some((m) => m.id === defaultRef.modelId)
        ? defaultRef.modelId
        : (models.find((m) => m.enabled)?.id ?? models[0]?.id ?? '');
    setDefaultModel(preferred);
    setListQuery('');
    setComboOpen(false);
    setErr(null);
    setMsg(null);
  };

  const pickDefault = (id: string) => {
    setDefaultModel(id);
    setEnabledIds((cur) => (cur.includes(id) ? cur : [...cur, id]));
    setComboOpen(false);
    if (!editingId) setPresetId('custom');
  };

  const toggleEnabled = (id: string, on: boolean) => {
    setEnabledIds((cur) => {
      if (on) return cur.includes(id) ? cur : [...cur, id];
      return cur.filter((x) => x !== id);
    });
  };

  const discover = async (): Promise<RemoteModelHint[] | null> => {
    setErr(null);
    setMsg(null);
    setComboOpen(false);
    if (kind !== 'heuristic' && !baseUrl.trim()) {
      setErr(t('nav.fillBaseUrl'));
      return null;
    }
    if (kind !== 'heuristic' && !apiKey.trim() && !editingId) {
      setErr(t('nav.fillApiKey'));
      return null;
    }
    try {
      if (editingId && !apiKey.trim()) {
        const scanned = (await api(`/api/model-providers/${encodeURIComponent(editingId)}/scan`, {
          method: 'POST'
        })) as ModelProvidersResponse & { ok?: boolean; error?: string; provider?: PublicModelProvider };
        if (scanned.ok === false) {
          setErr(scanned.error || t('nav.discoverFailed'));
          return null;
        }
        const models = scanned.provider?.models ?? [];
        const hints = models.map((m) => ({ id: m.id, ownedBy: m.ownedBy }));
        setPreview(hints);
        setEnabledIds(models.filter((m) => m.enabled).map((m) => m.id));
        const keep = defaultModel.trim();
        const nextPick = keep && hints.some((m) => m.id === keep) ? keep : hints[0]?.id ?? keep;
        setDefaultModel(nextPick);
        setMsg(t('nav.discoveredModels', { count: hints.length }));
        onSaved(scanned);
        return hints;
      }
      const listed = (await api('/api/model-providers/preview-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, baseUrl, apiKey })
      })) as PreviewScanResponse;
      if (!listed.ok) {
        setPreview([]);
        setEnabledIds([]);
        setErr(listed.error || t('nav.discoverFailed'));
        return null;
      }
      setPreview(listed.models);
      setEnabledIds(listed.models.map((m) => m.id));
      const derived = listed.endpoint ? baseUrlFromModelsEndpoint(listed.endpoint) : undefined;
      if (derived && kind === 'openai-compatible') setBaseUrl(derived);
      const keep = defaultModel.trim();
      const nextPick = keep && listed.models.some((m) => m.id === keep) ? keep : listed.models[0]?.id ?? keep;
      setDefaultModel(nextPick);
      setComboOpen(false);
      if (!name.trim() && listed.suggestedName) setName(listed.suggestedName);
      setMsg(t('nav.discoveredModels', { count: listed.models.length }));
      return listed.models;
    } catch (e) {
      setPreview([]);
      setEnabledIds([]);
      setErr(e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  const save = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      let scanned = preview;
      const typed = defaultModel.trim();
      if (!scanned.length && !typed) {
        const listed = await discover();
        if (!listed?.length) {
          setErr(t('nav.discoverThenFill'));
          return;
        }
        scanned = listed;
      }
      const seen = new Set(scanned.map((m) => m.id));
      const models: RemoteModelHint[] = typed && !seen.has(typed) ? [...scanned, { id: typed }] : scanned;
      const selected = (typed && models.some((m) => m.id === typed) ? typed : undefined) ?? models[0]?.id;
      const enabled = new Set(enabledIds);
      if (!preview.length) {
        for (const m of scanned) enabled.add(m.id);
      }
      if (selected) enabled.add(selected);
      const modelPayload = models.map((m) => ({
        id: m.id,
        ownedBy: m.ownedBy,
        enabled: enabled.has(m.id)
      }));
      const next = (
        editingId
          ? await api(`/api/model-providers/${encodeURIComponent(editingId)}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: name.trim(),
                kind,
                baseUrl,
                ...(apiKey.trim() ? { apiKey } : {}),
                models: modelPayload
              })
            })
          : await api('/api/model-providers', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: name.trim(),
                kind,
                baseUrl,
                apiKey,
                useJsonMode: true,
                models: modelPayload
              })
            })
      ) as ModelProvidersResponse & { provider?: PublicModelProvider };
      const resetDraft = () => {
        startNew();
      };
      if (next.provider?.id && selected) {
        const withDefault = (await api('/api/model-providers/default', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ defaultRef: { providerId: next.provider.id, modelId: selected } })
        })) as ModelProvidersResponse;
        resetDraft();
        setMsg(t('nav.providerAddedWithModel', { name: selected }));
        onSaved({ ...withDefault, provider: next.provider });
        return;
      }
      resetDraft();
      setMsg(t('nav.providerAdded'));
      onSaved(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`model-setup-form${compact ? ' model-setup-form--compact' : ''}`}>
      {configured.length ? (
        <div className="model-preset-row" role="group" aria-label={t('nav.configuredProviders')}>
          {configured.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`btn btn-ghost btn-sm${editingId === p.id ? ' is-on' : ''}`}
              disabled={busy}
              onClick={() => loadConfigured(p)}
            >
              {p.name}
            </button>
          ))}
          <button
            type="button"
            className={`btn btn-ghost btn-sm${editingId === null ? ' is-on' : ''}`}
            disabled={busy}
            onClick={startNew}
          >
            {t('nav.newProviderChip')}
          </button>
        </div>
      ) : null}
      {editingId === null ? (
        <label className="field">
          <span>{t('nav.addType')}</span>
          <select
            value={presetId}
            disabled={busy}
            onChange={(e) => applyPreset(e.target.value)}
          >
            {MODEL_PROVIDER_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === 'custom' ? t('nav.customType') : p.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="row-3">
        <label className="field">
          <span>{t('nav.nameOptional')}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('nav.namePlaceholder')}
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span>{t('nav.protocol')}</span>
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as ModelProviderKind);
              if (!editingId) setPresetId('custom');
            }}
          >
            {KIND_IDS.map((id) => (
              <option key={id} value={id}>
                {kindLabel(id, t)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('nav.baseUrl')}</span>
          <input
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              if (!editingId) setPresetId('custom');
            }}
            placeholder="https://api.example.com/v1"
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span>{t('nav.apiKey')}</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              editingId
                ? savedKeyMasked
                  ? t('nav.apiKeySavedKeep', { masked: savedKeyMasked })
                  : t('more.apiKeyKeep')
                : t('nav.apiKeyPlaceholder')
            }
            autoComplete="off"
          />
        </label>
        <div className="field model-default-combo" ref={comboRef}>
          <span>{t('nav.defaultModel')}</span>
          <input
            value={defaultModel}
            onChange={(e) => {
              setDefaultModel(e.target.value);
              if (!editingId) setPresetId('custom');
              if (preview.length) setComboOpen(true);
            }}
            onFocus={() => {
              if (preview.length) setComboOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filtered[0]) {
                e.preventDefault();
                pickDefault(filtered[0].id);
              }
            }}
            placeholder={preview.length ? t('nav.searchDiscovered') : t('nav.discoverOrType')}
            autoComplete="off"
            role="combobox"
            aria-expanded={comboOpen}
            aria-controls="modelDefaultList"
            aria-autocomplete="list"
          />
          {comboOpen && preview.length ? (
            <ul id="modelDefaultList" className="model-default-combo__list" role="listbox" aria-label={t('nav.discoveredList')}>
              {filtered.length ? (
                filtered.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={defaultModel === m.id}
                      className={`model-default-combo__option${defaultModel === m.id ? ' is-selected' : ''}`}
                      onClick={() => pickDefault(m.id)}
                    >
                      <code>{m.id}</code>
                      {m.ownedBy ? <small className="muted"> · {m.ownedBy}</small> : null}
                    </button>
                  </li>
                ))
              ) : (
                <li className="muted model-default-combo__empty">{t('nav.noMatchType', { id: defaultModel.trim() })}</li>
              )}
            </ul>
          ) : null}
        </div>
      </div>
      {err ? <p className="muted err">{err}</p> : null}
      {msg ? <p className="muted ok">{msg}</p> : null}
      {preview.length ? (
        <section className="model-pick-panel" aria-label={t('more.availableModelsAria')}>
          <div className="model-pick-panel__head">
            <h4>{t('more.availableModelsTitle')}</h4>
            <span className="muted" style={{ fontSize: '0.75rem' }}>
              {t('nav.willAppearInChat', { count: enabledIds.length, total: preview.length })}
            </span>
          </div>
          <p className="muted" style={{ fontSize: '0.75rem', margin: '4px 0 0' }}>
            {t('more.availableModelsHint')}
          </p>
          {preview.length > 8 ? (
            <label className="field" style={{ marginTop: 8 }}>
              <span>{t('more.filterModels')}</span>
              <input
                value={listQuery}
                onChange={(e) => setListQuery(e.target.value)}
                placeholder={t('more.searchModels')}
                autoComplete="off"
              />
            </label>
          ) : null}
          <div className="model-pick-panel__actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => setEnabledIds(preview.map((m) => m.id))}
            >
              {t('nav.selectAll')}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => setEnabledIds(defaultModel.trim() ? [defaultModel.trim()] : [])}
            >
              {t('nav.selectNone')}
            </button>
          </div>
          <ul className="model-scan-list">
            {listed.map((m) => (
              <li key={m.id}>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={enabledSet.has(m.id)}
                    disabled={busy}
                    onChange={(e) => toggleEnabled(m.id, e.target.checked)}
                  />
                  <span>
                    <code>{m.id}</code>
                    {m.ownedBy ? <span className="muted"> · {m.ownedBy}</span> : null}
                    {defaultModel.trim() === m.id ? (
                      <span className="muted">{t('more.defaultSuffix')}</span>
                    ) : null}
                  </span>
                </label>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => pickDefault(m.id)}
                >
                  {t('more.sourceDefault')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="model-setup-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void discover().finally(() => setBusy(false));
          }}
        >
          {busy ? t('nav.discovering') : t('nav.discoverModels')}
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || !baseUrl.trim() || (!editingId && !apiKey.trim())}
          onClick={() => void save()}
        >
          {defaultModel.trim()
            ? editingId
              ? t('nav.saveAndUse', { name: defaultModel.trim() })
              : t('nav.addAndUse', { name: defaultModel.trim() })
            : editingId
              ? t('nav.saveProvider')
              : t('nav.addProvider')}
        </button>
        {onCancel ? (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onCancel}>
            {t('common.cancel')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
