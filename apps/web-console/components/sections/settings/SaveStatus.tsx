'use client';

import { useI18n } from '@/lib/i18n';

export type SaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'error';

export interface SaveStatusProps {
  state: SaveState;
  /** 失败时的具体原因（已本地化） */
  error?: string | null;
  /** 覆盖「已保存」默认文案（如需带上下文） */
  savedLabel?: string;
}

/** 设置卡片统一的保存状态行：未保存 / 保存中 / 已保存 / 失败（role=status，无障碍可读）。 */
export function SaveStatus({ state, error, savedLabel }: SaveStatusProps) {
  const { t } = useI18n();
  if (state === 'clean') return null;
  if (state === 'error') {
    return (
      <p className="save-status save-status--error" role="alert">
        {error || t('settings.saveState.failed')}
      </p>
    );
  }
  const text =
    state === 'dirty'
      ? t('settings.saveState.dirty')
      : state === 'saving'
        ? t('settings.saveState.saving')
        : (savedLabel ?? t('settings.saveState.saved'));
  return (
    <p className={`save-status save-status--${state}`} role="status" aria-live="polite">
      <span className="save-status__dot" aria-hidden="true" />
      {text}
    </p>
  );
}
