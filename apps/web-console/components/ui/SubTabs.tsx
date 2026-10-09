'use client';

export interface SubTabItem {
  id: string;
  label: string;
  badge?: number | string;
}

export interface SubTabsProps {
  items: readonly SubTabItem[];
  active: string | null;
  onSelect: (id: string) => void;
  ariaLabel: string;
  /** 用于 DOM id：`<idPrefix>-tab-<item.id>` */
  idPrefix: string;
}

export function SubTabs({ items, active, onSelect, ariaLabel, idPrefix }: SubTabsProps) {
  return (
    <div className="ui-subtabs" role="tablist" aria-label={ariaLabel}>
      {items.map((item) => {
        const selected = item.id === active;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${item.id}`}
            aria-selected={selected}
            className={`ui-subtabs__tab${selected ? ' is-active' : ''}`}
            onClick={() => onSelect(item.id)}
          >
            {item.label}
            {item.badge !== undefined && item.badge !== 0 ? (
              <span className="ui-subtabs__badge">{item.badge}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
