'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import type { SettingsStatus } from './settings-store';
import './settings-kit.css';

export interface FieldRowProps {
  /** 控件的 DOM id；行容器为 `row-<id>` */
  id: string;
  label: string;
  hint?: string;
  /** 默认值的人话描述；传入后显示「默认：xxx」 */
  defaultText?: string;
  /** 当前值是否等于默认值；为 false 且提供 onRestore 时显示「恢复默认」 */
  isDefault?: boolean;
  onRestore?: () => void;
  busy?: boolean;
  error?: string;
  children: ReactNode;
}

export function FieldRow({ id, label, hint, defaultText, isDefault = true, onRestore, busy, error, children }: FieldRowProps) {
  const { t } = useI18n();
  return (
    <div className="settings-field" id={`row-${id}`}>
      <div className="settings-field__text">
        <label className="settings-field__label" htmlFor={id}>
          {label}
        </label>
        {hint ? (
          <p className="settings-field__hint" id={`${id}-hint`}>
            {hint}
          </p>
        ) : null}
      </div>
      <div className="settings-field__control">
        {children}
        {defaultText !== undefined || error ? (
          <div className="settings-field__meta">
            {defaultText !== undefined ? (
              <span className="settings-field__default">{t('settingsEntries.common.defaultValue', { value: defaultText })}</span>
            ) : null}
            {defaultText !== undefined && !isDefault && onRestore ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                aria-label={t('settingsEntries.common.restoreDefaultAria', { name: label })}
                onClick={onRestore}
              >
                {t('settingsEntries.common.restoreDefault')}
              </button>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <p className="settings-field__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export interface ChoiceOption<V extends string> {
  value: V;
  label: string;
}

export function SelectField<V extends string>({
  id,
  value,
  options,
  onChange,
  disabled,
  ...row
}: Omit<FieldRowProps, 'children'> & {
  value: V;
  options: readonly ChoiceOption<V>[];
  onChange: (value: V) => void;
  disabled?: boolean;
}) {
  return (
    <FieldRow id={id} busy={disabled} {...row}>
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-describedby={row.hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value as V)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldRow>
  );
}

export function ToggleField({
  id,
  checked,
  onChange,
  disabled,
  ...row
}: Omit<FieldRowProps, 'children'> & {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <FieldRow id={id} busy={disabled} {...row}>
      <label className="settings-switch">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          aria-describedby={row.hint ? `${id}-hint` : undefined}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span aria-hidden="true">{checked ? t('settingsEntries.common.on') : t('settingsEntries.common.off')}</span>
      </label>
    </FieldRow>
  );
}

export function TextField({
  id,
  value,
  onChange,
  disabled,
  type = 'text',
  placeholder,
  inputMode,
  onBlur,
  ...row
}: Omit<FieldRowProps, 'children'> & {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  type?: 'text' | 'url' | 'password' | 'number';
  placeholder?: string;
  inputMode?: 'numeric' | 'text';
  onBlur?: () => void;
}) {
  return (
    <FieldRow id={id} busy={disabled} {...row}>
      <input
        id={id}
        type={type}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete={type === 'password' ? 'new-password' : 'off'}
        aria-invalid={row.error ? true : undefined}
        aria-describedby={row.hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
    </FieldRow>
  );
}

export function SaveBar({
  dirty,
  busy,
  onSave,
  onReset,
  children
}: {
  dirty: boolean;
  busy?: boolean;
  onSave: () => void;
  onReset: () => void;
  /** 额外的动作按钮（测试连接等） */
  children?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="settings-savebar">
      {dirty ? <span className="settings-savebar__dirty">{t('settingsEntries.common.unsaved')}</span> : null}
      <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || busy} onClick={onSave}>
        {t('settingsEntries.common.save')}
      </button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={!dirty || busy} onClick={onReset}>
        {t('settingsEntries.common.undo')}
      </button>
      {children}
    </div>
  );
}

export function StatusLine({ status }: { status: SettingsStatus }) {
  if (!status) return null;
  return status.kind === 'ok' ? (
    <p className="settings-status" role="status">
      {status.text}
    </p>
  ) : (
    <p className="settings-status settings-status--err" role="alert">
      {status.text}
    </p>
  );
}

export function RiskNotice({ children }: { children: ReactNode }) {
  return (
    <p className="settings-risk" role="alert">
      {children}
    </p>
  );
}

export function SourceBadge({ source }: { source: string | undefined }) {
  const { t } = useI18n();
  if (!source) return null;
  const text =
    source === 'ui'
      ? t('settingsEntries.common.sourceUi')
      : source === 'env'
        ? t('settingsEntries.common.sourceEnv')
        : t('settingsEntries.common.sourceDefault');
  return <span className="badge settings-source">{text}</span>;
}

/** 加载中 / 加载失败占位；`ready` 为真时渲染 children */
export function LoadGate({
  ready,
  error,
  onRetry,
  children
}: {
  ready: boolean;
  error: string | null;
  onRetry: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  if (ready) return <>{children}</>;
  if (error) {
    return (
      <div className="settings-load settings-load--err" role="alert">
        <span>{t('settingsEntries.common.loadFailed', { error })}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
          {t('settingsEntries.common.retry')}
        </button>
      </div>
    );
  }
  return <p className="settings-load muted">{t('settingsEntries.common.loading')}</p>;
}

export function SubHead({ title, description }: { title: string; description?: string }) {
  return (
    <div className="settings-subhead">
      <h3 className="settings-subhead__title">{title}</h3>
      {description ? <p className="settings-subhead__desc">{description}</p> : null}
    </div>
  );
}
