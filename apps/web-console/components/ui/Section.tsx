import type { ReactNode } from 'react';

export interface SectionProps {
  /** DOM id，约定 `section-<id>` 或 `section-<id>-<sub>` */
  id?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  /** 页头下方的子导航（SubTabs 等） */
  nav?: ReactNode;
  children: ReactNode;
}

export function Section({ id, title, description, actions, nav, children }: SectionProps) {
  return (
    <section className="ui-section" id={id} aria-labelledby={id ? `${id}-title` : undefined}>
      <header className="ui-section__head">
        <div className="ui-section__heading">
          <h1 className="ui-section__title" id={id ? `${id}-title` : undefined}>
            {title}
          </h1>
          {description ? <p className="ui-section__desc">{description}</p> : null}
        </div>
        {actions ? <div className="ui-section__actions">{actions}</div> : null}
      </header>
      {nav ? <div className="ui-section__nav">{nav}</div> : null}
      <div className="ui-section__body">{children}</div>
    </section>
  );
}
