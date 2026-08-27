'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

export type SteerDrainPolicy = 'next_shot_only' | 'tool_launch';

interface LoopSettings {
  steerDrainPolicy: SteerDrainPolicy;
  inboxOverflowCap: number | null;
  updatedAt: string;
}

interface SettingsResponse {
  settings: LoopSettings;
  effective: {
    steerDrainPolicy: SteerDrainPolicy;
    inboxOverflowCap: number | null;
    source: string;
  };
}

async function saveLoopSettings(patch: Partial<LoopSettings>): Promise<SettingsResponse> {
  return (await api('/api/loop/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  })) as SettingsResponse;
}

export function AgentLoopSettingsCard({ compact = false }: { compact?: boolean }) {
  const [settings, setSettings] = useState<LoopSettings | null>(null);
  const [effective, setEffective] = useState<SettingsResponse['effective'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [capDraft, setCapDraft] = useState('');

  const load = useCallback(async () => {
    setErr(null);
    try {
      const data = (await api('/api/loop/settings')) as SettingsResponse;
      setSettings(data.settings);
      setEffective(data.effective);
      setCapDraft(
        data.settings.inboxOverflowCap == null ? '' : String(data.settings.inboxOverflowCap)
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (patch: Partial<LoopSettings>) => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const data = await saveLoopSettings(patch);
      setSettings(data.settings);
      setEffective(data.effective);
      setCapDraft(
        data.settings.inboxOverflowCap == null ? '' : String(data.settings.inboxOverflowCap)
      );
      setMsg('已保存，立即生效（无需改 .env / 重启）');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const commitCap = () => {
    if (!settings) return;
    const raw = capDraft.trim();
    let next: number | null = null;
    if (raw !== '') {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) {
        setErr('inbox overflow 上限须为非负整数，或留空表示无限');
        return;
      }
      next = n === 0 ? null : n;
    }
    if (next === settings.inboxOverflowCap) return;
    void save({ inboxOverflowCap: next });
  };

  if (!settings) {
    if (compact) {
      return <span className="muted">{err ?? '加载中…'}</span>;
    }
    return (
      <div className="card">
        <div className="card-head">
          <h3>Agent Loop</h3>
        </div>
        <div className="empty-hint">{err ?? '加载中…'}</div>
      </div>
    );
  }

  const select = (
    <label className={compact ? 'field field--inline' : 'field'}>
      <span>工具发射边界 drain</span>
      <select
        disabled={busy}
        value={settings.steerDrainPolicy}
        aria-label="工具发射边界 drain"
        onChange={(e) => void save({ steerDrainPolicy: e.target.value as SteerDrainPolicy })}
      >
        <option value="next_shot_only">关（仅下一枪，默认）</option>
        <option value="tool_launch">开（发射前跳过未启动工具）</option>
      </select>
    </label>
  );

  const capInput = (
    <label className={compact ? 'field field--inline' : 'field'}>
      <span>Inbox overflow 上限</span>
      <input
        type="number"
        min={0}
        step={1}
        disabled={busy}
        value={capDraft}
        placeholder="无限（默认）"
        aria-label="Inbox overflow 上限"
        onChange={(e) => setCapDraft(e.target.value)}
        onBlur={() => commitCap()}
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
        {capInput}
        {msg ? <p className="muted" style={{ fontSize: '0.75rem', margin: '4px 0 0' }}>{msg}</p> : null}
        {err ? <p style={{ color: 'var(--danger, #c44)', fontSize: '0.75rem', margin: '4px 0 0' }}>{err}</p> : null}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h3>Agent Loop</h3>
        <span className="badge">{effective?.source === 'ui' ? '界面配置' : '默认'}</span>
      </div>
      <p className="muted" style={{ fontSize: '0.8rem', marginTop: 0 }}>
        插话默认只进入下一枪，不改正在飞的模型请求。打开 drain 后，core 在工具发射前跳过尚未启动的
        sequential 调用（保存立即写入 KV，无需改 .env / 重启）。
      </p>
      {select}
      <p className="muted" style={{ fontSize: '0.75rem' }}>
        生效: {settings.steerDrainPolicy === 'tool_launch' ? 'tool_launch（工具发射前 drain）' : 'next_shot_only'}
      </p>
      <p className="muted" style={{ fontSize: '0.8rem' }}>
        Inbox 默认不丢。填入正整数（建议 20）后，unclaimed 超过上限时把最旧合成一条 system
        inbox（确定性拼接，drop=summarize）；留空或 0 表示无限。
      </p>
      {capInput}
      <p className="muted" style={{ fontSize: '0.75rem' }}>
        生效:{' '}
        {settings.inboxOverflowCap == null
          ? '无限（不丢 inbox）'
          : `cap=${settings.inboxOverflowCap}（overflow summarize）`}
      </p>
      {msg ? <div className="muted" style={{ fontSize: '0.8rem' }}>{msg}</div> : null}
      {err ? <div style={{ color: 'var(--danger, #c44)', fontSize: '0.8rem' }}>{err}</div> : null}
    </div>
  );
}
