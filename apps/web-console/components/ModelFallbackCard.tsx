'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { ModelRef } from '@/lib/model-providers';

interface FallbackOption extends ModelRef {
  providerName: string;
}

interface FallbackEntryStatus extends ModelRef {
  usable: boolean;
  issue?: 'not_configured' | 'missing_credentials';
}

interface FallbackResponse {
  settings: { chain: ModelRef[]; updatedAt: string };
  options: FallbackOption[];
  chainStatus: FallbackEntryStatus[];
  effective: { enabled: boolean; source: 'ui' | 'default' };
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const refKey = (ref: ModelRef) => `${ref.providerId}::${ref.modelId}`;

function sameChain(a: ModelRef[], b: ModelRef[]): boolean {
  return a.length === b.length && a.every((ref, i) => refKey(ref) === refKey(b[i]!));
}

export function ModelFallbackCard() {
  const { t } = useI18n();
  const [data, setData] = useState<FallbackResponse | null>(null);
  const [draft, setDraft] = useState<ModelRef[]>([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const apply = useCallback((next: FallbackResponse) => {
    setData(next);
    setDraft(next.settings.chain);
  }, []);

  const load = useCallback(async () => {
    try {
      apply((await api('/api/model-fallback/settings')) as FallbackResponse);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [apply]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    return (
      <div className="card" id="card-model-fallback">
        <div className="card-head">
          <h3>{t('modelFallback.title')}</h3>
        </div>
        <div className="empty-hint">{err ?? t('common.loading')}</div>
      </div>
    );
  }

  const labelOf = (ref: ModelRef) => {
    const option = data.options.find((o) => refKey(o) === refKey(ref));
    return `${option?.providerName ?? ref.providerId} / ${ref.modelId}`;
  };
  const statusOf = (ref: ModelRef) => data.chainStatus.find((s) => refKey(s) === refKey(ref));
  const available = data.options.filter((o) => !draft.some((ref) => refKey(ref) === refKey(o)));
  const dirty = !sameChain(draft, data.settings.chain);
  const usableCount = data.chainStatus.filter((s) => s.usable).length;

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= draft.length) return;
    const next = [...draft];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setDraft(next);
  };

  const add = () => {
    const option = available.find((o) => refKey(o) === pick);
    if (!option) return;
    setDraft([...draft, { providerId: option.providerId, modelId: option.modelId }]);
    setPick('');
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      apply(
        (await api('/api/model-fallback/settings', {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify({ chain: draft })
        })) as FallbackResponse
      );
      setMsg(t('more.savedNoRestart'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" id="card-model-fallback">
      <div className="card-head">
        <h3>{t('modelFallback.title')}</h3>
        <span className="badge">{data.effective.source === 'ui' ? t('more.sourceUi') : t('more.sourceDefault')}</span>
        <span className="badge">{t('modelFallback.effectiveCount', { count: usableCount })}</span>
      </div>
      <p className="muted" style={{ fontSize: '0.8rem', marginTop: 0 }}>
        {t('modelFallback.desc')}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h4 style={{ margin: 0 }}>{t('modelFallback.chainTitle')}</h4>
        {!draft.length ? (
          <div className="empty-hint">{t('modelFallback.empty')}</div>
        ) : (
          <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {draft.map((ref, index) => {
              const status = statusOf(ref);
              const issue = status && !status.usable ? status.issue : undefined;
              return (
                <li key={refKey(ref)} data-testid={`model-fallback-row-${ref.providerId}/${ref.modelId}`}>
                  <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong>{labelOf(ref)}</strong>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      {t('modelFallback.moveUp')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy || index === draft.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      {t('modelFallback.moveDown')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => setDraft(draft.filter((_, i) => i !== index))}
                    >
                      {t('modelFallback.remove')}
                    </button>
                  </div>
                  {issue ? (
                    <div style={{ color: 'var(--danger, #c44)', fontSize: '0.75rem' }}>
                      {issue === 'missing_credentials'
                        ? t('modelFallback.issueMissingCredentials')
                        : t('modelFallback.issueNotConfigured')}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}

        {available.length ? (
          <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              aria-label={t('modelFallback.addLabel')}
              value={pick}
              disabled={busy}
              onChange={(e) => setPick(e.target.value)}
            >
              <option value="">{t('modelFallback.addPlaceholder')}</option>
              {available.map((o) => (
                <option key={refKey(o)} value={refKey(o)}>
                  {`${o.providerName} / ${o.modelId}`}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !pick} onClick={add}>
              {t('modelFallback.add')}
            </button>
          </div>
        ) : !draft.length ? (
          <div className="muted" style={{ fontSize: '0.8rem' }}>
            {t('modelFallback.noOptions')}
          </div>
        ) : null}

        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || !dirty} onClick={() => void save()}>
            {t('modelFallback.save')}
          </button>
          {dirty ? (
            <span className="muted" style={{ fontSize: '0.75rem' }}>
              {t('modelFallback.dirty')}
            </span>
          ) : null}
        </div>
        {msg ? <div className="muted" style={{ fontSize: '0.8rem' }}>{msg}</div> : null}
        {err ? <div style={{ color: 'var(--danger, #c44)', fontSize: '0.8rem' }}>{err}</div> : null}
      </div>
    </div>
  );
}
