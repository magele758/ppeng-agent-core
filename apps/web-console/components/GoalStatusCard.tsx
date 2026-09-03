'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface GoalWire {
  goalId: string;
  status: string;
  closeReason?: string;
  condition: string;
  turnsUsed: number;
  maxTurns: number;
  missing?: string[];
  spec?: { verify?: { kind: string; paths?: string[]; url?: string } };
}

export function GoalStatusCard({ sessionId }: { sessionId: string | null }) {
  const { t } = useI18n();
  const [goal, setGoal] = useState<GoalWire | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) {
      setGoal(null);
      return;
    }
    try {
      const data = (await api(`/api/sessions/${encodeURIComponent(sessionId)}/goal`)) as {
        goal: GoalWire | null;
      };
      setGoal(data.goal);
    } catch {
      setGoal(null);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
    if (!sessionId) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [load, sessionId]);

  if (!sessionId || !goal) return null;

  const tone =
    goal.status === 'achieved' ? 'is-ok' : goal.status === 'unmet_closed' ? 'is-warn' : '';

  return (
    <div className={`goal-status-card ${tone}`} role="status">
      <span className="goal-status-card__label">Goal</span>
      <strong>{goal.status}</strong>
      {goal.closeReason ? <span className="muted"> · {goal.closeReason}</span> : null}
      <span className="muted">
        {' '}
        · {goal.turnsUsed}/{goal.maxTurns}
      </span>
      {goal.spec?.verify?.kind ? (
        <span className="muted"> · verify {goal.spec.verify.kind}</span>
      ) : (
        <span className="muted">{t('play.goalCard.softGate')}</span>
      )}
      {goal.condition ? (
        <div className="goal-status-card__cond" title={goal.condition}>
          {goal.condition}
        </div>
      ) : null}
    </div>
  );
}
