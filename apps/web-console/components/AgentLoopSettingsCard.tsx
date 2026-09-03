'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { ConfigGroup, FieldLabel } from './ConfigGroup';
import { SKILL_SCOPE_OPTIONS, TASK_MODE_OPTIONS } from './TaskModePicker';

export type SteerDrainPolicy = 'next_shot_only' | 'tool_launch';
export type SteerInterruptPolicy = 'queue' | 'steer' | 'disabled';

type LabTaskMode =
  | 'computer'
  | 'browser'
  | 'auto'
  | 'deep_research'
  | 'planner'
  | 'teams'
  | 'fast'
  | 'dynamic_workflow';
type LabSkillScope = 'full' | 'requested';

interface LoopSettings {
  steerDrainPolicy: SteerDrainPolicy;
  inboxOverflowCap: number | null;
  defaultTaskMode: LabTaskMode;
  defaultSkillScope: LabSkillScope;
  steerInterruptPolicy: SteerInterruptPolicy;
  updatedAt: string;
}

interface SettingsResponse {
  settings: LoopSettings;
  effective: {
    steerDrainPolicy: SteerDrainPolicy;
    inboxOverflowCap: number | null;
    steerInterruptPolicy?: SteerInterruptPolicy;
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

function taskModeKey(value: LabTaskMode): MessageKey {
  switch (value) {
    case 'auto':
      return 'more.taskModeAuto';
    case 'fast':
      return 'more.taskModeFast';
    case 'planner':
      return 'more.taskModePlanner';
    case 'teams':
      return 'more.taskModeTeams';
    case 'deep_research':
      return 'more.taskModeDeepResearch';
    case 'browser':
      return 'more.taskModeBrowser';
    case 'computer':
      return 'more.taskModeComputer';
    case 'dynamic_workflow':
      return 'more.taskModeDynamicWorkflow';
    default: {
      const _never: never = value;
      return _never;
    }
  }
}

function skillScopeKey(value: LabSkillScope): MessageKey {
  switch (value) {
    case 'full':
      return 'more.skillScopeFull';
    case 'requested':
      return 'more.skillScopeRequested';
    default: {
      const _never: never = value;
      return _never;
    }
  }
}

export function AgentLoopSettingsCard({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
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
      setMsg(t('more.savedNoRestart'));
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
        setErr(t('more.loopInboxCapInvalid'));
        return;
      }
      next = n === 0 ? null : n;
    }
    if (next === settings.inboxOverflowCap) return;
    void save({ inboxOverflowCap: next });
  };

  if (!settings) {
    if (compact) {
      return <span className="muted">{err ?? t('common.loading')}</span>;
    }
    return (
      <div className="card">
        <div className="card-head">
          <h3>{t('more.loopTitle')}</h3>
        </div>
        <div className="empty-hint">{err ?? t('common.loading')}</div>
      </div>
    );
  }

  const select = (
    <label className={compact ? 'field field--inline' : 'field'}>
      <FieldLabel tip={t('more.loopDrainTip')}>
        {t('more.loopDrainLabel')}
      </FieldLabel>
      <select
        disabled={busy}
        value={settings.steerDrainPolicy}
        aria-label={t('more.loopDrainAria')}
        onChange={(e) => void save({ steerDrainPolicy: e.target.value as SteerDrainPolicy })}
      >
        <option value="next_shot_only">{t('more.loopDrainOff')}</option>
        <option value="tool_launch">{t('more.loopDrainOn')}</option>
      </select>
    </label>
  );

  const taskModeSelect = (
    <label className={compact ? 'field field--inline' : 'field'}>
      <span>{t('more.loopTaskMode')}</span>
      <select
        disabled={busy}
        value={settings.defaultTaskMode ?? 'auto'}
        aria-label={t('more.loopTaskMode')}
        onChange={(e) => void save({ defaultTaskMode: e.target.value as LabTaskMode })}
      >
        {TASK_MODE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {t(taskModeKey(opt.value))}
          </option>
        ))}
      </select>
    </label>
  );

  const skillScopeSelect = (
    <label className={compact ? 'field field--inline' : 'field'}>
      <span>{t('more.loopSkillScope')}</span>
      <select
        disabled={busy}
        value={settings.defaultSkillScope ?? 'full'}
        aria-label={t('more.loopSkillScopeAria')}
        onChange={(e) => void save({ defaultSkillScope: e.target.value as LabSkillScope })}
      >
        {SKILL_SCOPE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {t(skillScopeKey(opt.value))}
          </option>
        ))}
      </select>
    </label>
  );

  const interruptSelect = (
    <label className={compact ? 'field field--inline' : 'field'}>
      <FieldLabel tip={t('more.loopInterruptTip')}>
        {t('more.loopInterruptLabel')}
      </FieldLabel>
      <select
        disabled={busy}
        value={settings.steerInterruptPolicy ?? 'queue'}
        aria-label={t('more.loopInterruptAria')}
        onChange={(e) => void save({ steerInterruptPolicy: e.target.value as SteerInterruptPolicy })}
      >
        <option value="queue">{t('more.loopInterruptQueue')}</option>
        <option value="steer">{t('more.loopInterruptSteer')}</option>
        <option value="disabled">{t('more.loopInterruptDisabled')}</option>
      </select>
    </label>
  );

  const capInput = (
    <label className={compact ? 'field field--inline' : 'field'}>
      <FieldLabel tip={t('more.loopInboxCapTip')}>
        {t('more.loopInboxCap')}
      </FieldLabel>
      <input
        type="number"
        min={0}
        step={1}
        disabled={busy}
        value={capDraft}
        placeholder={t('more.loopInboxUnlimited')}
        aria-label={t('more.loopInboxCap')}
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
      <ConfigGroup
        title={t('more.loopDefaultsGroup')}
        tip={t('more.loopDefaultsGroupTip')}
      >
        {taskModeSelect}
        {skillScopeSelect}
        {capInput}
        {msg ? <p className="muted" style={{ fontSize: '0.75rem', margin: '4px 0 0' }}>{msg}</p> : null}
        {err ? <p style={{ color: 'var(--danger, #c44)', fontSize: '0.75rem', margin: '4px 0 0' }}>{err}</p> : null}
      </ConfigGroup>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h3>{t('more.loopTitle')}</h3>
        <span className="badge">{effective?.source === 'ui' ? t('more.sourceUi') : t('more.sourceDefault')}</span>
      </div>
      <p className="muted" style={{ fontSize: '0.8rem', marginTop: 0 }}>
        {t('more.loopDesc')}
      </p>
      {select}
      {interruptSelect}
      {taskModeSelect}
      {skillScopeSelect}
      <p className="muted" style={{ fontSize: '0.75rem' }}>
        {t('more.effectivePrefix')}
        {settings.steerDrainPolicy === 'tool_launch' ? t('more.loopEffectiveDrainOn') : 'next_shot_only'}
        {' · '}
        {t('more.loopInterruptPrefix')}
        {settings.steerInterruptPolicy ?? 'queue'}
        {' · '}
        TaskMode={settings.defaultTaskMode ?? 'auto'}
        {' · '}
        skill_scope={settings.defaultSkillScope ?? 'full'}
      </p>
      <p className="muted" style={{ fontSize: '0.8rem' }}>
        {t('more.loopInboxDesc')}
      </p>
      {capInput}
      <p className="muted" style={{ fontSize: '0.75rem' }}>
        {t('more.effectivePrefix')}
        {settings.inboxOverflowCap == null
          ? t('more.loopInboxUnlimitedEffective')
          : t('more.loopInboxCapEffective', { cap: settings.inboxOverflowCap })}
      </p>
      {msg ? <div className="muted" style={{ fontSize: '0.8rem' }}>{msg}</div> : null}
      {err ? <div style={{ color: 'var(--danger, #c44)', fontSize: '0.8rem' }}>{err}</div> : null}
    </div>
  );
}
