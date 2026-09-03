'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { ConfigGroup, FieldLabel } from './ConfigGroup';

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

function policyHintKey(policy: CompactPolicy): MessageKey {
  switch (policy) {
    case 'after_any_assistant':
      return 'more.compactHintAfterAny';
    case 'after_text_assistant':
      return 'more.compactHintAfterText';
    case 'keep_recent':
      return 'more.compactHintKeepRecent';
    default: {
      const _never: never = policy;
      return _never;
    }
  }
}

export function CompactSettingsCard({
  compact = false,
  sessionStats
}: {
  compact?: boolean;
  sessionStats?: { collapsed: number; charsSaved: number } | null;
}) {
  const { t } = useI18n();
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
      setMsg(t('more.savedNoRestart'));
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
      setErr(t('more.compactKeepRecentInvalid'));
      return;
    }
    if (n === settings.keepRecent) return;
    void save({ keepRecent: n });
  };

  if (!settings) {
    if (compact) {
      return <span className="muted">{err ?? t('common.loading')}</span>;
    }
    return (
      <div className="card">
        <div className="card-head">
          <h3>{t('more.compactTitle')}</h3>
        </div>
        <div className="empty-hint">{err ?? t('common.loading')}</div>
      </div>
    );
  }

  const select = (
    <label className={compact ? 'field field--inline' : 'field'}>
      <FieldLabel tip={t('more.compactCollapseTip')}>
        {t('more.compactCollapseLabel')}
      </FieldLabel>
      <select
        disabled={busy}
        value={settings.policy}
        aria-label={t('more.compactPolicyAria')}
        onChange={(e) => void save({ policy: e.target.value as CompactPolicy })}
      >
        <option value="keep_recent">{t('more.compactPolicyKeepRecent')}</option>
        <option value="after_text_assistant">{t('more.compactPolicyAfterText')}</option>
        <option value="after_any_assistant">{t('more.compactPolicyAfterAny')}</option>
      </select>
    </label>
  );

  const keepInput = (
    <label className={compact ? 'field field--inline' : 'field'}>
      <span>{t('more.compactKeepRecent')}</span>
      <input
        type="number"
        min={0}
        max={50}
        step={1}
        disabled={busy || settings.policy !== 'keep_recent'}
        value={keepDraft}
        aria-label={t('more.compactKeepRecent')}
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

  const statsLine =
    sessionStats != null ? (
      <p className="muted compact-session-stats" style={{ fontSize: '0.75rem', margin: '4px 0 0' }}>
        {t('more.compactSessionStats', {
          collapsed: sessionStats.collapsed,
          chars: sessionStats.charsSaved
        })}
      </p>
    ) : null;

  const effectiveLine = (
    <p className="muted compact-effective-policy" style={{ fontSize: '0.75rem', margin: '4px 0 0' }}>
      {t('more.effectivePrefix')}policy={effective?.policy ?? settings.policy}
      {(effective?.policy ?? settings.policy) === 'keep_recent'
        ? ` · keepRecent=${effective?.keepRecent ?? settings.keepRecent}`
        : ''}
      {effective && !effective.enabled ? t('more.compactMicroOff') : ''}
    </p>
  );

  if (compact) {
    return (
      <ConfigGroup
        title={t('more.compactGroupTitle')}
        tip={t('more.compactGroupTip')}
      >
        {select}
        {settings.policy === 'keep_recent' ? keepInput : null}
        {effectiveLine}
        {statsLine}
        {msg ? <p className="muted" style={{ fontSize: '0.75rem', margin: '4px 0 0' }}>{msg}</p> : null}
        {err ? <p style={{ color: 'var(--danger, #c44)', fontSize: '0.75rem', margin: '4px 0 0' }}>{err}</p> : null}
      </ConfigGroup>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h3>{t('more.compactTitle')}</h3>
        <span className="badge">{effective?.source === 'ui' ? t('more.sourceUi') : t('more.sourceDefault')}</span>
      </div>
      <p className="muted" style={{ fontSize: '0.8rem', marginTop: 0 }}>
        {t('more.compactDesc')}
      </p>
      {select}
      <p className="muted" style={{ fontSize: '0.75rem' }}>
        {t(policyHintKey(settings.policy))}
      </p>
      {keepInput}
      {effectiveLine}
      {statsLine}
      {msg ? <div className="muted" style={{ fontSize: '0.8rem' }}>{msg}</div> : null}
      {err ? <div style={{ color: 'var(--danger, #c44)', fontSize: '0.8rem' }}>{err}</div> : null}
    </div>
  );
}
