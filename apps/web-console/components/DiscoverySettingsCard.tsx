'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface DiscoverySettings {
  enabled: boolean;
  tailscaleEnabled: boolean;
  activeScanEnabled: boolean;
  hostAllowlist: string[];
  cidrAllowlist: string[];
  statusJsonPath?: string;
  updatedAt: string;
}

interface SettingsResponse {
  settings: DiscoverySettings;
  effective: {
    enabled: boolean;
    tailscaleEnabled: boolean;
    source: string;
  };
}

export function DiscoverySettingsCard() {
  const [settings, setSettings] = useState<DiscoverySettings | null>(null);
  const [effective, setEffective] = useState<SettingsResponse['effective'] | null>(null);
  const [hostText, setHostText] = useState('');
  const [cidrText, setCidrText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const data = (await api('/api/capabilities/settings')) as SettingsResponse;
      setSettings(data.settings);
      setEffective(data.effective);
      setHostText((data.settings.hostAllowlist ?? []).join(', '));
      setCidrText((data.settings.cidrAllowlist ?? []).join(', '));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (patch: Partial<DiscoverySettings> & { hostAllowlist?: string[]; cidrAllowlist?: string[] }) => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const data = (await api('/api/capabilities/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      })) as SettingsResponse;
      setSettings(data.settings);
      setEffective(data.effective);
      setHostText((data.settings.hostAllowlist ?? []).join(', '));
      setCidrText((data.settings.cidrAllowlist ?? []).join(', '));
      setMsg('已保存，立即生效（无需改 .env / 重启）');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const probeTailscale = async () => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const data = (await api('/api/capabilities/probe/tailscale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      })) as { count?: number; source?: string };
      setMsg(`Tailscale 探查完成：${data.count ?? 0} 个节点（来源 ${data.source ?? '—'}）`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!settings) {
    return (
      <div className="card">
        <div className="card-head">
          <h3>能力发现</h3>
        </div>
        <div className="empty-hint">{err ?? '加载中…'}</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h3>能力发现</h3>
        <span className="badge">{effective?.source === 'ui' ? '界面配置' : '默认/环境回退'}</span>
      </div>
      <p className="muted" style={{ fontSize: '0.8rem', marginTop: 0 }}>
        主开关在界面持久化，立即生效。环境变量仅作 CI / 从未配置时的回退。
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={busy}
            onChange={(e) => void save({ enabled: e.target.checked })}
          />
          <span>启用能力发现（Registry / Tool Search）</span>
          <span className="muted" style={{ fontSize: '0.75rem' }}>
            生效: {effective?.enabled ? '开' : '关'}
          </span>
        </label>
        <label className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={settings.tailscaleEnabled}
            disabled={busy || !settings.enabled}
            onChange={(e) => void save({ tailscaleEnabled: e.target.checked })}
          />
          <span>启用 Tailscale 设备池</span>
          <span className="muted" style={{ fontSize: '0.75rem' }}>
            生效: {effective?.tailscaleEnabled ? '开' : '关'}
          </span>
        </label>
        <label className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={settings.activeScanEnabled}
            disabled={busy || !settings.enabled}
            onChange={(e) => void save({ activeScanEnabled: e.target.checked })}
          />
          <span>允许主动扫描（危险，默认关）</span>
        </label>
        <label className="field">
          <span>Host 白名单（逗号分隔）</span>
          <input
            value={hostText}
            disabled={busy}
            onChange={(e) => setHostText(e.target.value)}
            onBlur={() => {
              const next = hostText
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
              const prev = settings.hostAllowlist.join('|');
              if (next.join('|') !== prev) void save({ hostAllowlist: next });
            }}
            placeholder="api.example.com"
          />
        </label>
        <label className="field">
          <span>CIDR 白名单（逗号分隔）</span>
          <input
            value={cidrText}
            disabled={busy}
            onChange={(e) => setCidrText(e.target.value)}
            onBlur={() => {
              const next = cidrText
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
              const prev = settings.cidrAllowlist.join('|');
              if (next.join('|') !== prev) void save({ cidrAllowlist: next });
            }}
            placeholder="100.64.0.0/10, 10.0.0.0/8"
          />
        </label>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || !effective?.tailscaleEnabled}
            onClick={() => void probeTailscale()}
          >
            探查 Tailscale 节点
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void load()}>
            刷新
          </button>
        </div>
        {msg ? <div className="muted" style={{ fontSize: '0.8rem' }}>{msg}</div> : null}
        {err ? <div style={{ color: 'var(--danger, #c44)', fontSize: '0.8rem' }}>{err}</div> : null}
      </div>
    </div>
  );
}
