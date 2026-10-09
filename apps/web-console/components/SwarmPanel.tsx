'use client';

import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useCallback, useState, type FormEvent } from 'react';
import { Disclosure } from './sections/agents/Disclosure';

export type SwarmRunRow = {
  id: string;
  goal: string;
  status: string;
  strategy: string;
  createdAt?: string;
  updatedAt?: string;
};

export const SWARM_STRATEGIES = [
  'pipeline',
  'parallel-review',
  'best-of-n',
  'debate',
  'research-implement-review'
] as const;
export type SwarmStrategyChoice = (typeof SWARM_STRATEGIES)[number];

const JSON_HEADERS = { 'content-type': 'application/json' };

interface SwarmStartFormProps {
  onStarted: (run: SwarmRunRow) => void;
}

/** 只需一个目标即可创建并启动 Swarm；策略收在「高级」里。 */
export function SwarmStartForm({ onStarted }: SwarmStartFormProps) {
  const { t } = useI18n();
  const [goal, setGoal] = useState('');
  const [strategy, setStrategy] = useState<SwarmStrategyChoice>('pipeline');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = goal.trim();

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setTouched(true);
      if (!trimmed || busy) return;
      setBusy(true);
      setError(null);
      try {
        const created = (await api('/api/swarm/runs', {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ goal: trimmed, strategy })
        })) as { run: SwarmRunRow };
        await api(`/api/swarm/runs/${created.run.id}/start`, {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({
            tasks: [{ title: trimmed.slice(0, 120), requiredRole: 'implementer' }]
          })
        });
        setGoal('');
        setTouched(false);
        onStarted(created.run);
      } catch (err) {
        setError(t('agents.teams.startFailed', { error: err instanceof Error ? err.message : String(err) }));
      } finally {
        setBusy(false);
      }
    },
    [busy, onStarted, strategy, t, trimmed]
  );

  return (
    <form className="ag-panel ag-form" aria-label={t('agents.teams.startTitle')} onSubmit={(e) => void submit(e)} noValidate>
      <div>
        <h3 className="ag-panel__title">{t('agents.teams.startTitle')}</h3>
        <p className="ag-panel__lead">{t('agents.teams.startDesc')}</p>
      </div>
      <label className="ag-field">
        <span className="ag-field__label">{t('agents.teams.goalLabel')}</span>
        <input
          className="ag-input"
          value={goal}
          placeholder={t('agents.teams.goalPh')}
          aria-required="true"
          aria-invalid={touched && !trimmed}
          onChange={(e) => setGoal(e.target.value)}
        />
        {touched && !trimmed ? (
          <span className="ag-field__error" role="alert">
            {t('agents.teams.goalRequired')}
          </span>
        ) : null}
      </label>
      <Disclosure label={t('agents.common.advanced')}>
        <label className="ag-field">
          <span className="ag-field__label">{t('agents.teams.strategyLabel')}</span>
          <select
            className="ag-input"
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as SwarmStrategyChoice)}
          >
            {SWARM_STRATEGIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <span className="ag-field__hint">{t('agents.teams.strategyHint')}</span>
        </label>
      </Disclosure>
      {error ? (
        <p className="ag-status ag-status--err" role="alert">
          {error}
        </p>
      ) : null}
      <div className="ag-form__actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? t('agents.teams.starting') : t('agents.teams.start')}
        </button>
      </div>
    </form>
  );
}
