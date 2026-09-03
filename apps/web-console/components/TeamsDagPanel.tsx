'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface TeamDagTask {
  id: string;
  title: string;
  status: string;
  role: string;
  dependsOn: string[];
}

interface TeamGateState {
  name: string;
  status: string;
  checker: string;
  feedback?: string;
}

interface TeamPlan {
  id: string;
  objective: string;
  status: string;
  tasks: TeamDagTask[];
  gates: TeamGateState[];
  releasable?: boolean;
  plannerSource?: string;
  updatedAt: string;
}

interface TeamsDagSettings {
  enabled: boolean;
  maxConcurrent: number;
  workspaceSyncMode: 'directory-copy' | 'git-worktree';
  usePlannerLlm: boolean;
  gates?: {
    review: { enabled: boolean; checker: string; command?: string };
    regression: { enabled: boolean; checker: string; command?: string };
    release: { enabled: boolean; checker: string; command?: string };
  };
}

export function TeamsDagPanel() {
  const { t } = useI18n();
  const [plans, setPlans] = useState<TeamPlan[]>([]);
  const [settings, setSettings] = useState<TeamsDagSettings | null>(null);
  const [objective, setObjective] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [planData, settingData] = await Promise.all([
        api('/api/teams/plans') as Promise<{ plans: TeamPlan[] }>,
        api('/api/teams/dag/settings') as Promise<{ settings: TeamsDagSettings }>
      ]);
      setPlans(planData.plans ?? []);
      setSettings(settingData.settings);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveSettings = async (patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      const data = (await api('/api/teams/dag/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      })) as { settings: TeamsDagSettings };
      setSettings(data.settings);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const createAndStart = async () => {
    const obj = objective.trim();
    if (!obj) return;
    setBusy(true);
    setErr(null);
    try {
      const created = (await api('/api/teams/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objective: obj })
      })) as { plan: TeamPlan };
      await api(`/api/teams/plans/${encodeURIComponent(created.plan.id)}/start`, { method: 'POST' });
      setObjective('');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const resume = async (id: string) => {
    setBusy(true);
    try {
      await api(`/api/teams/plans/${encodeURIComponent(id)}/resume`, { method: 'POST' });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (planId: string, gate: string, passed: boolean) => {
    setBusy(true);
    try {
      await api(`/api/teams/plans/${encodeURIComponent(planId)}/gates/${encodeURIComponent(gate)}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passed })
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card teams-dag-panel">
      <div className="card-head">
        <h3>{t('teams.dagTitle')}</h3>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>
          {t('common.refresh')}
        </button>
      </div>
      <p className="muted small">
        {t('teams.dagHint')}
      </p>
      {settings ? (
        <div className="teams-form" style={{ flexWrap: 'wrap', gap: 8 }}>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.enabled}
              disabled={busy}
              onChange={(e) => void saveSettings({ enabled: e.target.checked })}
            />
            <span>{t('teams.enabled')}</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.usePlannerLlm}
              disabled={busy}
              onChange={(e) => void saveSettings({ usePlannerLlm: e.target.checked })}
            />
            <span>{t('teams.plannerLlm')}</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.workspaceSyncMode === 'git-worktree'}
              disabled={busy}
              onChange={(e) =>
                void saveSettings({
                  workspaceSyncMode: e.target.checked ? 'git-worktree' : 'directory-copy'
                })
              }
            />
            <span>{t('teams.gitWorktree')}</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.gates?.review?.enabled !== false}
              disabled={busy}
              onChange={(e) =>
                void saveSettings({ gates: { review: { enabled: e.target.checked } } })
              }
            />
            <span>{t('teams.gateReview')}</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.gates?.regression?.enabled === true}
              disabled={busy}
              onChange={(e) =>
                void saveSettings({ gates: { regression: { enabled: e.target.checked } } })
              }
            />
            <span>{t('teams.gateRegression')}</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.gates?.release?.enabled !== false}
              disabled={busy}
              onChange={(e) =>
                void saveSettings({ gates: { release: { enabled: e.target.checked } } })
              }
            />
            <span>{t('teams.gateRelease')}</span>
          </label>
        </div>
      ) : null}
      <div className="teams-form">
        <textarea
          rows={2}
          placeholder={t('teams.objectivePh')}
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
        />
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void createAndStart()}>
          {t('teams.planStart')}
        </button>
      </div>
      {err ? <p className="muted small">{err}</p> : null}
      <div className="list-scroll">
        {!plans.length ? (
          <div className="empty-hint">{t('teams.emptyPlans')}</div>
        ) : (
          plans.map((p) => (
            <div key={p.id} className="list-item" style={{ cursor: 'default' }}>
              <div className="row">
                <strong>{p.status}</strong>
                {p.releasable ? ` · ${t('teams.releasable')}` : ''}
                {p.plannerSource ? ` · ${p.plannerSource}` : ''} · {p.objective}
              </div>
              <div className="muted small">{p.tasks.map((task) => `${task.id}:${task.status}`).join(' → ')}</div>
              <div className="muted small">
                {t('teams.gates')}{' '}
                {(p.gates ?? []).map((g) => `${g.name}:${g.status}`).join(' / ') || '—'}
              </div>
              <div className="row" style={{ gap: 8, marginTop: 6 }}>
                {p.status === 'running' || p.status === 'paused' || p.status === 'drafting' ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => void resume(p.id)}
                  >
                    {t('teams.resume')}
                  </button>
                ) : null}
                {(p.gates ?? [])
                  .filter((g) => g.status === 'awaiting_human' || (g.checker === 'human' && g.status === 'pending'))
                  .map((g) => (
                    <span key={g.name}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => void decide(p.id, g.name, true)}
                      >
                        {t('teams.gatePass', { name: g.name })}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => void decide(p.id, g.name, false)}
                      >
                        {t('teams.gateReject', { name: g.name })}
                      </button>
                    </span>
                  ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
