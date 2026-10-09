'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import {
  MODEL_PROVIDERS_CHANGED_EVENT,
  modelSetupState,
  type ModelProvidersResponse,
  type ModelSetupState
} from '@/lib/model-providers';

/** Shared, self-refreshing view of the provider catalog (re-fetches when any card changes it). */
export function useModelCatalog(): {
  catalog: ModelProvidersResponse | null;
  setup: ModelSetupState | null;
  reload: () => Promise<void>;
} {
  const [catalog, setCatalog] = useState<ModelProvidersResponse | null>(null);

  const reload = useCallback(async () => {
    try {
      setCatalog((await api('/api/model-providers')) as ModelProvidersResponse);
    } catch {
      setCatalog(null);
    }
  }, []);

  useEffect(() => {
    void reload();
    window.addEventListener(MODEL_PROVIDERS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(MODEL_PROVIDERS_CHANGED_EVENT, reload);
  }, [reload]);

  return { catalog, setup: catalog ? modelSetupState(catalog) : null, reload };
}
