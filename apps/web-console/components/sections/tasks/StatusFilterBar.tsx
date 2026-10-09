'use client';

import { useI18n } from '@/lib/i18n';
import type { StatusFilter } from './task-filters';
import styles from './tasks.module.css';

export interface StatusFilterBarProps<S extends string> {
  id: string;
  statuses: readonly S[];
  active: StatusFilter<S>;
  counts: Record<StatusFilter<S>, number>;
  labelOf: (status: StatusFilter<S>) => string;
  onChange: (status: StatusFilter<S>) => void;
}

export function StatusFilterBar<S extends string>({ id, statuses, active, counts, labelOf, onChange }: StatusFilterBarProps<S>) {
  const { t } = useI18n();
  const options: StatusFilter<S>[] = ['all', ...statuses];
  return (
    <div id={id} className={styles.filters} role="group" aria-label={t('tasks.filterLabel')}>
      {options.map((status) => (
        <button
          key={status}
          type="button"
          data-testid={`status-filter-${status}`}
          aria-pressed={active === status}
          className={`${styles.filter}${active === status ? ` ${styles.filterActive}` : ''}`}
          onClick={() => onChange(status)}
        >
          {labelOf(status)}
          <span className={styles.filterCount}>{counts[status]}</span>
        </button>
      ))}
    </div>
  );
}
