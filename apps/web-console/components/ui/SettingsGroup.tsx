'use client';

import { useState, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import { useAdvancedMode } from './useAdvancedMode';

export interface SettingsGroupProps {
  title: string;
  description?: string;
  /** 高级分组：未开启「显示高级」且无搜索时不渲染 */
  advanced?: boolean;
  /** 可折叠（用于次要内容）；默认展开 */
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** 搜索命中时强制展示高级分组 */
  forceVisible?: boolean;
  id?: string;
  children: ReactNode;
}

export function SettingsGroup({
  title,
  description,
  advanced = false,
  collapsible = false,
  defaultOpen = true,
  forceVisible = false,
  id,
  children
}: SettingsGroupProps) {
  const { t } = useI18n();
  const [advancedOn] = useAdvancedMode();
  const [open, setOpen] = useState(defaultOpen);
  if (advanced && !advancedOn && !forceVisible) return null;
  const expanded = !collapsible || open;
  return (
    <section className={`ui-group${advanced ? ' ui-group--advanced' : ''}`} id={id} aria-label={title}>
      <header className="ui-group__head">
        <div className="ui-group__heading">
          <h2 className="ui-group__title">{title}</h2>
          {description ? <p className="ui-group__desc">{description}</p> : null}
        </div>
        {collapsible ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-expanded={expanded}
            aria-label={t('shell.ui.toggleGroup', { title })}
            onClick={() => setOpen((v) => !v)}
          >
            {expanded ? '−' : '+'}
          </button>
        ) : null}
      </header>
      {expanded ? <div className="ui-group__body">{children}</div> : null}
    </section>
  );
}
