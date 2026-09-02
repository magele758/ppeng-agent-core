'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { ModelProvidersResponse, PublicModelProvider } from '@/lib/model-providers';
import { ModelSetupForm } from './ModelSetupForm';

export type ModelProvidersCardProps = {
  onCatalogChange?: (data: ModelProvidersResponse) => void;
  heading?: string;
};

export function ModelProvidersCard({ onCatalogChange, heading = '模型服务商' }: ModelProvidersCardProps) {
  const [data, setData] = useState<ModelProvidersResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBaseUrl, setEditBaseUrl] = useState('');
  const [editApiKey, setEditApiKey] = useState('');
  const [modelQuery, setModelQuery] = useState('');
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
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const uiProviders = (data?.catalog.providers ?? []).filter((p) => p.source === 'ui');

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
        setErr(next.error || '扫描失败');
      } else {
        setMsg(`已扫描 ${next.scanned ?? 0} 个模型，可在对话区选择`);
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
      setMsg('已删除');
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
      setMsg(`已设为默认：${modelId}`);
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
        setErr('请填写新的 Base URL 或 API Key');
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
        <h3>{heading}</h3>
        <span className="badge">{uiProviders.length}</span>
      </div>
      <p className="muted" style={{ fontSize: '0.8rem', margin: '0 0 8px' }}>
        填 Base URL 与 API Key，自动发现模型，不必手填模型名，也不必改 .env / 重启。
        {data?.effective.source === 'env' ? ' 当前仍可用 .env 回退。' : null}
      </p>
      {err ? <p className="muted err">{err}</p> : null}
      {msg ? <p className="muted ok">{msg}</p> : null}

      <ModelSetupForm
        onSaved={(next) => {
          apply(next);
          setMsg('已保存。可在对话里切换模型。');
        }}
      />

      <div className="list-scroll" style={{ marginTop: 12, maxHeight: 360 }}>
        {!uiProviders.length ? (
          <div className="empty-hint">还没有服务商。发现模型并保存后即可在对话区选择。</div>
        ) : (
          uiProviders.map((p) => {
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
                    {p.kind} · {p.apiKeyMasked || '无密钥'}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: '0.75rem' }}>
                  {p.baseUrl || '—'}
                  {p.scannedAt ? ` · 扫描于 ${p.scannedAt.slice(0, 19).replace('T', ' ')}` : ''}
                </div>
                {p.scanError ? (
                  <div className="muted err" style={{ fontSize: '0.75rem' }}>
                    {p.scanError}
                  </div>
                ) : null}
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {p.kind !== 'heuristic' ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busy}
                      onClick={() => void scan(p.id)}
                    >
                      重新发现
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
                    {editingId === p.id ? '取消编辑' : '改地址/密钥'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => void remove(p.id)}
                  >
                    删除
                  </button>
                </div>
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
                        placeholder="留空则不改"
                        autoComplete="off"
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={busy}
                      onClick={() => void saveEdit(p.id)}
                    >
                      保存并重新发现
                    </button>
                  </div>
                ) : null}
                {p.models.length ? (
                  <>
                    {p.models.length > 8 ? (
                      <label className="field" style={{ marginTop: 8 }}>
                        <span>筛选模型</span>
                        <input
                          value={modelQuery}
                          onChange={(e) => setModelQuery(e.target.value)}
                          placeholder="搜索模型名"
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
                              disabled={busy}
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
                            默认
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <div className="muted" style={{ fontSize: '0.75rem', marginTop: 6 }}>
                    尚未发现模型
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
