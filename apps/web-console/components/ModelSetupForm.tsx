'use client';

import { useId, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type {
  ModelProviderKind,
  ModelProvidersResponse,
  PreviewScanResponse,
  PublicModelProvider,
  RemoteModelHint
} from '@/lib/model-providers';
import { MODEL_PROVIDER_PRESETS } from '@/lib/model-providers';

const KINDS: Array<{ id: ModelProviderKind; label: string }> = [
  { id: 'openai-compatible', label: 'OpenAI 兼容' },
  { id: 'anthropic-compatible', label: 'Anthropic 兼容' }
];

export type ModelSetupFormProps = {
  onSaved: (data: ModelProvidersResponse & { provider?: PublicModelProvider }) => void;
  compact?: boolean;
};

export function ModelSetupForm({ onSaved, compact }: ModelSetupFormProps) {
  const [presetId, setPresetId] = useState('openai');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ModelProviderKind>('openai-compatible');
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [useJsonMode, setUseJsonMode] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<RemoteModelHint[]>([]);
  const [picked, setPicked] = useState<string>('');
  const [query, setQuery] = useState('');
  const pickName = useId();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return preview;
    return preview.filter(
      (m) => m.id.toLowerCase().includes(q) || (m.ownedBy ?? '').toLowerCase().includes(q)
    );
  }, [preview, query]);

  const applyPreset = (id: string) => {
    const preset = MODEL_PROVIDER_PRESETS.find((p) => p.id === id);
    setPresetId(id);
    if (!preset) return;
    setKind(preset.kind);
    setBaseUrl(preset.baseUrl);
    if (preset.apiKeyHint && !apiKey.trim()) setApiKey(preset.apiKeyHint);
    setPreview([]);
    setPicked('');
    setQuery('');
    setErr(null);
    setMsg(null);
  };

  const discover = async (): Promise<RemoteModelHint[] | null> => {
    setErr(null);
    setMsg(null);
    if (kind !== 'heuristic' && !baseUrl.trim()) {
      setErr('请填写 Base URL');
      return null;
    }
    if (kind !== 'heuristic' && !apiKey.trim()) {
      setErr('请填写 API Key');
      return null;
    }
    const listed = (await api('/api/model-providers/preview-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, baseUrl, apiKey })
    })) as PreviewScanResponse;
    if (!listed.ok) {
      setPreview([]);
      setPicked('');
      setErr(listed.error || '发现模型失败');
      return null;
    }
    setPreview(listed.models);
    const nextPick =
      picked && listed.models.some((m) => m.id === picked) ? picked : listed.models[0]?.id ?? '';
    setPicked(nextPick);
    if (!name.trim() && listed.suggestedName) setName(listed.suggestedName);
    setMsg(`发现 ${listed.models.length} 个模型，点选后保存即可，无需手填名称`);
    return listed.models;
  };

  const save = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      let models = preview;
      if (!models.length) {
        const listed = await discover();
        if (!listed?.length) return;
        models = listed;
      }
      const selected = picked && models.some((m) => m.id === picked) ? picked : models[0]?.id;
      const next = (await api('/api/model-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          kind,
          baseUrl,
          apiKey,
          useJsonMode,
          models: models.map((m) => ({
            id: m.id,
            ownedBy: m.ownedBy,
            enabled: true
          }))
        })
      })) as ModelProvidersResponse & { provider?: PublicModelProvider };
      if (next.provider?.id && selected) {
        const withDefault = (await api('/api/model-providers/default', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ defaultRef: { providerId: next.provider.id, modelId: selected } })
        })) as ModelProvidersResponse;
        setApiKey('');
        setMsg(`已保存，当前模型 ${selected}`);
        onSaved({ ...withDefault, provider: next.provider });
        return;
      }
      setApiKey('');
      setMsg('已保存');
      onSaved(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`model-setup-form${compact ? ' model-setup-form--compact' : ''}`}>
      <div className="model-preset-row" role="group" aria-label="常用服务商">
        {MODEL_PROVIDER_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`btn btn-ghost btn-sm${presetId === p.id ? ' is-on' : ''}`}
            disabled={busy}
            onClick={() => applyPreset(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="row-3">
        <label className="field">
          <span>名称（可选）</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="留空则按地址自动命名"
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span>协议</span>
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as ModelProviderKind);
              setPresetId('custom');
            }}
          >
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Base URL</span>
          <input
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              setPresetId('custom');
            }}
            placeholder="https://api.example.com/v1"
            autoComplete="off"
          />
        </label>
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
      {err ? <p className="muted err">{err}</p> : null}
      {msg ? <p className="muted ok">{msg}</p> : null}
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
          发现模型
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || !baseUrl.trim() || !apiKey.trim()}
          onClick={() => void save()}
        >
          {picked ? `保存并使用 ${picked}` : '发现并保存'}
        </button>
      </div>
      {preview.length ? (
        <div className="model-pick">
          <label className="field">
            <span>从服务发现的模型（{filtered.length}/{preview.length}）</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索模型名"
              autoComplete="off"
            />
          </label>
          <ul className="model-pick-list">
            {filtered.map((m) => (
              <li key={m.id}>
                <label className="toggle">
                  <input
                    type="radio"
                    name={pickName}
                    checked={picked === m.id}
                    disabled={busy}
                    onChange={() => setPicked(m.id)}
                  />
                  <span>
                    <code>{m.id}</code>
                    {m.ownedBy ? <span className="muted"> · {m.ownedBy}</span> : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
