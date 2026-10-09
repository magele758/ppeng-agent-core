'use client';

import { useI18n } from '@/lib/i18n';
import { EmptyState } from '../../ui';

export function NoMatch({ onClear }: { onClear: () => void }) {
  const { t } = useI18n();
  return (
    <EmptyState
      title={t('agents.common.noMatchTitle')}
      description={t('agents.common.noMatchDesc')}
      action={
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
          {t('agents.common.clearSearch')}
        </button>
      }
    />
  );
}
