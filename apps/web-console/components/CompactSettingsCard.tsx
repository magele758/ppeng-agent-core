'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

export type CompactPolicy = 'keep_recent' | 'after_any_assistant' | 'after_text_assistant';

interface CompactSettings {
  policy: CompactPolicy;
  keepRecent: number;
  updatedAt: string;
}

interface SettingsResponse {
  settings: CompactSettings;
  effective: {
    policy: CompactPolicy;
    keepRecent: number;
    enabled: boolean;
    source: string;
  };
}

async function saveCompactSettings(patch: Partial<CompactSettings>): Promise<SettingsResponse> {
  return (await api('/api/compact/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  })) as SettingsResponse;
}

function policyHint(policy: CompactPolicy): string {
  switch (policy) {
    case 'after_any_assistant':
      return '模型已经开过下一轮（含纯 tool_call）后，旧 tool_result 换成一行占位。连续工具波可能过早丢掉 listing。';
    case 'after_text_assistant':
      return '等助手写出正文后再占位，连续 tool_call 期间仍保留观察。更适合对照实验。';
    default:
      return '默认：只折叠更早的长 tool_result，最近 N 条全文保留（与现网一致）。';
  }
}

export function CompactSettingsCard({ compact = false }: { compact?: boolean }) {
  const [settings, setSettings] = useState<CompactSettings | null>(null);
  const [effective, setEffective] = useState<SettingsResponse['effective'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [keepDraft, setKeepDraft] = useState('3');

  const load = useCallback(async () => {
    setErr(null);
    try {
      const data = (await api('/api/compact/settings')) as SettingsResponse;
      setSettings(data.settings);
      setEffective(data.effective);
      setKeepDraft(String(data.settings.keepRecent));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (patch: Partial<CompactSettings>) => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const data = await saveCompactSettings(patch);
      setSettings(data.settings);
      setEffective(data.effective);
      setKeepDraft(String(data.settings.keepRecent));
      setMsg('已保存，立即生效（无需改 .env / 重启）');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const commitKeep = () => {
    if (!settings) return;
    const n = Number(keepDraft);
    if (!Number.isInteger(n) || n < 0 || n > 50) {
      setErr('保留条数须为 0–50 的整数');
      return;
    }
    if (n === settings.keepRecent) return;
    void save({ keepRecent: n });
  };

  if (!settings) {
    if (compact) {
      return <span className="muted">{err ?? '加载中…'}</span>;
    }
    return (
      <div className="card">
        <div className="card-head">
          <h3>工具结果压缩</h3>
        </div>
        <div className="empty-hint">{err ?? '加载中…'}</div>
      </div>
    );
  }

  const select = (
    <label className={compact ? 'field field--inline' : 'field'}>
      <span>消费后占位</span>
      <select
        disabled={busy}
        value={settings.policy}
        aria-label="工具结果压缩策略"
        onChange={(e) => void save({ policy: e.target.value as CompactPolicy })}
      >
        <option value="keep_recent">关（默认，保留最近 N 条）</option>
        <option value="after_text_assistant">开 · 等正文后再抽（推荐实验）</option>
        <option value="after_any_assistant">开 · 下一轮助手即抽（更激进）</option>
      </select>
    </label>
  );

  const keepInput = (
    <label className={compact ? 'field field--inline' : 'field'}>
      <span>默认策略保留条数</span>
      <input
        type="number"
        min={0}
        max={50}
        step={1}
        disabled={busy || settings.policy !== 'keep_recent'}
        value={keepDraft}
        aria-label="默认策略保留条数"
        onChange={(e) => setKeepDraft(e.target.value)}
        onBlur={() => commitKeep()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </label>
  );

  if (compact) {
    return (
      <div>
        {select}
        {settings.policy === 'keep_recent' ? keepInput : null}
        {msg ? <p className="muted" style={{ fontSize: '0.75rem', margin: '4px 0 0' }}>{msg}</p> : null}
        {err ? <p style={{ color: 'var(--danger, #c44)', fontSize: '0.75rem', margin: '4px 0 0' }}>{err}</p> : null}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h3>工具结果压缩</h3>
        <span className="badge">{effective?.source === 'ui' ? '界面配置' : '默认'}</span>
      </div>
      <p className="muted" style={{ fontSize: '0.8rem', marginTop: 0 }}>
        只改送给模型的视图，SQLite transcript 仍是全文。打开后，模型已经消费过的 tool_result
        会换成一行占位。保存立即写入 KV，无需改 .env / 重启。
      </p>
      {select}
      <p className="muted" style={{ fontSize: '0.75rem' }}>
        {policyHint(settings.policy)}
      </p>
      {keepInput}
      <p className="muted" style={{ fontSize: '0.75rem' }}>
        生效: policy={settings.policy}
        {settings.policy === 'keep_recent' ? ` · keepRecent=${settings.keepRecent}` : ''}
        {effective && !effective.enabled ? ' · 微压缩总开关已关（RAW_AGENT_MICRO_COMPACT=0）' : ''}
      </p>
      {msg ? <div className="muted" style={{ fontSize: '0.8rem' }}>{msg}</div> : null}
      {err ? <div style={{ color: 'var(--danger, #c44)', fontSize: '0.8rem' }}>{err}</div> : null}
    </div>
  );
}
