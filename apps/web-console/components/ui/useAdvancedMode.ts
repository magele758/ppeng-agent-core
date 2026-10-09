'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { ADVANCED_STORAGE_KEY, readStoredAdvanced, writeStoredAdvanced } from '@/lib/advanced-mode';

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === ADVANCED_STORAGE_KEY) cb();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

/** 全局「显示高级设置」偏好；SSR 恒为 false，挂载后读取 localStorage */
export function useAdvancedMode(): [boolean, (next: boolean) => void] {
  const advanced = useSyncExternalStore(
    subscribe,
    () => readStoredAdvanced(window.localStorage),
    () => false
  );
  const setAdvanced = useCallback((next: boolean) => {
    writeStoredAdvanced(window.localStorage, next);
    listeners.forEach((l) => l());
  }, []);
  return [advanced, setAdvanced];
}
