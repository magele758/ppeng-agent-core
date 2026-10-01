'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import {
  groupItems,
  groupKey,
  itemLabelKey,
  modeKey,
  noteKey,
  reasonKey,
  sourceKey,
  type ConfigNote,
  type EffectiveConfigPayload,
  type EffectiveItem
} from '@/lib/effective-config';
import { useI18n } from '@/lib/i18n';
import { getMessage } from '@/lib/i18n/t';
import type { MessageKey } from '@/lib/i18n/messages/types';

export function EffectiveConfigCard() {
  const { t, messages } = useI18n();
  const [data, setData] = useState<EffectiveConfigPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      setData((await api('/api/config/effective')) as EffectiveConfigPayload);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 优先用 i18n 文案；API 新增了前端还没翻译的 code 时退回服务端英文兜底。 */
  const translateCode = (key: string, fallback: string, params?: Record<string, string | number>) =>
    getMessage(messages, key) !== undefined ? t(key as MessageKey, params) : fallback;

  const noteText = (n: ConfigNote) => translateCode(noteKey(n.code), n.message, n.params);
  const reasonText = (it: EffectiveItem) => translateCode(reasonKey(it.reasonCode), it.reason, it.params);

  const hasWarnings = (data?.items ?? []).some((it) => it.warnings.length > 0);

  if (!data) {
    return (
      <div className="card" id="card-effective-config">
        <div className="card-head">
          <h3>{t('config.title')}</h3>
        </div>
        <div className="empty-hint">{err ? `${t('config.loadFailed')}: ${err}` : t('config.loading')}</div>
      </div>
    );
  }

  return (
    <div className="card" id="card-effective-config">
      <div className="card-head">
        <h3>{t('config.title')}</h3>
        <span className="badge" data-testid="effective-mode">
          {t(modeKey(data.mode))}
        </span>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void load()}>
          {t('config.refresh')}
        </button>
      </div>
      <p className="muted" style={{ fontSize: '0.8rem', marginTop: 0 }}>
        {t('config.desc')}
      </p>
      <p style={{ fontSize: '0.85rem', margin: '0 0 0.5rem' }} data-testid="effective-summary">
        {data.mode === 'local' && !hasWarnings
          ? t('config.localOnlyHint')
          : t('config.summaryLine', {
              external: data.summary.externalServices.length,
              auto: data.summary.autoEnabled.length,
              partial: data.summary.partial.length
            })}
      </p>
      {groupItems(data.items).map(({ group, items }) => (
        <div key={group} style={{ marginBottom: '0.6rem' }}>
          <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>
            {t(groupKey(group))}
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {items.map((it) => (
              <div key={it.id} className="list-item" data-testid={`effective-${it.id}`}>
                <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong>{translateCode(itemLabelKey(it.id), it.id)}</strong>
                  <span className="badge">{it.enabled
                      ? t('config.statusOn')
                      : it.group === 'storage'
                        ? t('config.statusLocal')
                        : t('config.statusOff')}</span>
                  <span className="badge">{t(sourceKey(it.source))}</span>
                  <code className="muted" style={{ fontSize: '0.72rem' }}>
                    {it.mode}
                  </code>
                </div>
                <div className="muted" style={{ fontSize: '0.78rem' }}>
                  {reasonText(it)}
                </div>
                {it.warnings.length > 0 ? (
                  <ul style={{ margin: '4px 0 0', paddingLeft: '1.1rem', fontSize: '0.78rem', color: 'var(--danger, #c44)' }}>
                    {it.warnings.map((w, i) => (
                      <li key={`${w.code}-${i}`} title={t('config.warningsTitle')}>
                        {noteText(w)}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {it.hints.length > 0 ? (
                  <ul className="muted" style={{ margin: '4px 0 0', paddingLeft: '1.1rem', fontSize: '0.75rem' }}>
                    {it.hints.map((h, i) => (
                      <li key={`${h.code}-${i}`} title={t('config.hintsTitle')}>
                        {noteText(h)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="muted" style={{ fontSize: '0.75rem', marginBottom: 0 }}>
        {t('config.howToChange')}
      </p>
      {err ? <div style={{ color: 'var(--danger, #c44)', fontSize: '0.8rem' }}>{err}</div> : null}
    </div>
  );
}
