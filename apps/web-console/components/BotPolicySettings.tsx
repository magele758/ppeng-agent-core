'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ConfigGroup, FieldLabel } from './ConfigGroup';

const TURN_CHOICES = [24, 48, 96] as const;

export function BotPolicySettings({
  botId,
  maxTurns,
  allowedTools,
  onSave
}: {
  botId: string | null;
  maxTurns: number;
  allowedTools: string[];
  onSave: (patch: { maxTurns?: number; allowedTools?: string[] }) => Promise<void>;
}) {
  const { t } = useI18n();
  const [catalog, setCatalog] = useState<string[]>([]);
  const [draft, setDraft] = useState<string[]>(allowedTools);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setDraft(allowedTools);
  }, [allowedTools]);

  useEffect(() => {
    let cancelled = false;
    void api('/api/tools')
      .then((data) => {
        if (cancelled) return;
        const tools = (data as { tools?: Array<{ name?: string }> }).tools ?? [];
        setCatalog(
          tools
            .map((tool) => (typeof tool.name === 'string' ? tool.name : ''))
            .filter((name) => name.length > 0)
        );
        setErr(null);
      })
      .catch(() => {
        if (!cancelled) setErr(t('play.botPolicy.catalogFailed'));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const turnValue = maxTurns === 48 || maxTurns === 96 ? maxTurns : 24;
  const optionNames = [...new Set([...catalog, ...draft])];

  const saveTurns = async (next: number) => {
    if (!botId || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onSave({ maxTurns: next });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveTools = async () => {
    if (!botId || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onSave({ allowedTools: draft });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfigGroup title={t('play.botPolicy.title')} tip={t('play.botPolicy.tip')}>
      {err ? <p className="bot-cron-panel__err">{err}</p> : null}
      <label className="field field--inline">
        <FieldLabel>{t('play.botPolicy.maxTurns')}</FieldLabel>
        <select
          value={turnValue}
          disabled={!botId || busy}
          aria-label={t('play.botPolicy.maxTurnsAria')}
          onChange={(e) => void saveTurns(Number(e.target.value))}
        >
          {TURN_CHOICES.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      </label>
      <label className="field field--inline field--grow">
        <span>{t('play.botPolicy.allowedTools')}</span>
        <select
          multiple
          className="bot-policy-tools"
          aria-label={t('play.botPolicy.allowedToolsAria')}
          value={draft}
          disabled={!botId || busy}
          onChange={(e) => {
            setDraft(Array.from(e.target.selectedOptions).map((option) => option.value));
          }}
        >
          {optionNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <p className="bot-cron-card__meta">{t('play.botPolicy.allowedToolsHint')}</p>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={!botId || busy}
        onClick={() => void saveTools()}
      >
        {busy ? t('play.botPolicy.saving') : t('play.botPolicy.saveTools')}
      </button>
    </ConfigGroup>
  );
}
