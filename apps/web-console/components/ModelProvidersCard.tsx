'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type {
  ModelProviderKind,
  ModelProvidersResponse,
  PublicModelProvider
} from '@/lib/model-providers';

const KINDS: Array<{ id: ModelProviderKind; label: string }> = [
  { id: 'openai-compatible', label: 'OpenAI 兼容' },
  { id: 'anthropic-compatible', label: 'Anthropic 兼容' },
  { id: 'heuristic', label: '本地启发式（无密钥）' }
];

export function ModelProvidersCard() {
  const [data, setData] = useState<ModelProvidersResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ModelProviderKind>('openai-compatible');
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [useJsonMode, setUseJsonMode] = useState(true);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const next = (await api('/api/model-providers')) as ModelProvidersResponse;
      setData(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const uiProviders = (data?.catalog.providers ?? []).filter((p) => p.source === 'ui');

  const add = async () => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const next = (await api('/api/model-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          kind,
          baseUrl: kind === 'heuristic' ? '' : baseUrl,
          apiKey: kind === 'heuristic' ? '' : apiKey,
          useJsonMode
        })
      })) as ModelProvidersResponse & { provider?: PublicModelProvider };
      setData(next);
      setApiKey('');
      setMsg('已保存。点「扫描模型」拉取列表后即可在对话里选择。');
      const id = next.provider?.id;
      if (id && kind !== 'heuristic') {
        await scan(id, next);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const scan = async (id: string, current?: ModelProvidersResponse) => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const next = (await api(`/api/model-providers/${encodeURIComponent(id)}/scan`, {
        method: 'POST'
      })) as ModelProvidersResponse & { ok?: boolean; error?: string; scanned?: number };
      setData(next);
      if (next.ok === false) {
        setErr(next.error || '扫描失败');
      } else {
        setMsg(`已扫描 ${next.scanned ?? 0} 个模型，可在对话区选择`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      if (current) setData(current);
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
      setData(next);
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
      setData(next);
      setMsg('已设为默认模型');
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
      setData(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h3>模型服务商</h3>
        <span className="badge">{uiProviders.length}</span>
      </div>
      <p className="muted" style={{ fontSize: '0.8rem', margin: '0 0 8px' }}>
        配置 Base URL 与 API Key，扫描模型后在对话里按服务商选择。不必改 .env / 重启。
        {data?.effective.source === 'env' ? ' 当前仍可用 .env 回退。' : null}
      </p>
      {err ? <p className="muted err">{err}</p> : null}
      {msg ? <p className="muted ok">{msg}</p> : null}

      <div className="row-3" style={{ marginBottom: 12 }}>
        <label className="field">
          <span>名称</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 DeepSeek" />
        </label>
        <label className="field">
          <span>协议</span>
          <select
            id="providerKind"
            value={kind}
            onChange={(e) => setKind(e.target.value as ModelProviderKind)}
          >
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        {kind !== 'heuristic' ? (
          <label className="field">
            <span>Base URL</span>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </label>
        ) : null}
        {kind !== 'heuristic' ? (
          <label className="field">
            <span>API Key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="不会完整回显"
              autoComplete="off"
            />
          </label>
        ) : null}
        {kind === 'openai-compatible' ? (
          <label className="toggle field-toggle">
            <input
              type="checkbox"
              checked={useJsonMode}
              onChange={(e) => setUseJsonMode(e.target.checked)}
            />
            <span>JSON mode</span>
          </label>
        ) : null}
      </div>
      <button type="button" className="btn btn-primary btn-sm" disabled={busy || !name.trim()} onClick={() => void add()}>
        添加并扫描
      </button>

      <div className="list-scroll" style={{ marginTop: 12, maxHeight: 320 }}>
        {!uiProviders.length ? (
          <div className="empty-hint">还没有服务商。添加后扫描模型，即可在对话区选择。</div>
        ) : (
          uiProviders.map((p) => (
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
                    扫描模型
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => void remove(p.id)}
                >
                  删除
                </button>
              </div>
              {p.models.length ? (
                <ul className="model-scan-list">
                  {p.models.map((m) => (
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
              ) : (
                <div className="muted" style={{ fontSize: '0.75rem', marginTop: 6 }}>
                  尚未扫描到模型
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
