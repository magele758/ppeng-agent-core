'use client';

import { useI18n } from '@/lib/i18n';
import { useEffect } from 'react';
import type { ModelProvidersResponse } from '@/lib/model-providers';
import { ModelProvidersCard } from './ModelProvidersCard';

export type ModelSettingsDialogProps = {
  open: boolean;
  onClose: () => void;
  onCatalogChange?: (data: ModelProvidersResponse) => void;
};

export function ModelSettingsDialog({ open, onClose, onCatalogChange }: ModelSettingsDialogProps) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="model-setup-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="model-setup-dialog" role="dialog" aria-modal="true" aria-labelledby="modelSetupTitle">
        <div className="model-setup-dialog__bar">
          <h2 id="modelSetupTitle">{t('nav.configureModel')}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
        <ModelProvidersCard heading={t('nav.modelProviders')} onCatalogChange={onCatalogChange} />
      </div>
    </div>
  );
}
