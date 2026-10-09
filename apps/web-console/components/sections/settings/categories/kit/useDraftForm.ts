'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isDirty as modelIsDirty } from '@/lib/settings-fields';

export type FormValue = string | boolean | string[];
export type FormModel = Record<string, FormValue>;

export interface DraftForm<T extends FormModel> {
  draft: T;
  set: <K extends keyof T>(key: K, value: T[K]) => void;
  reset: () => void;
  dirty: boolean;
  errors: Partial<Record<keyof T, string>>;
  setErrors: (errors: Partial<Record<keyof T, string>>) => void;
  setError: (key: keyof T, message: string | undefined) => void;
}

/**
 * 表单草稿：`saved` 是服务端已保存值映射成的模型。
 * 有未保存修改时，外部刷新（别的卡片保存）不会冲掉用户正在编辑的内容。
 */
export function useDraftForm<T extends FormModel>(saved: T | null, fallback: T): DraftForm<T> {
  const [draft, setDraft] = useState<T>(saved ?? fallback);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});
  const prevSaved = useRef<T | null>(saved);
  const keys = useMemo(() => Object.keys(fallback) as (keyof T)[], [fallback]);

  useEffect(() => {
    if (!saved) return;
    const previous = prevSaved.current;
    prevSaved.current = saved;
    if (previous === saved) return;
    setDraft((current) => (previous && modelIsDirty(current, previous, keys) ? current : saved));
    setErrors({});
  }, [saved, keys]);

  const baseline = saved ?? fallback;
  const dirty = modelIsDirty(draft, baseline, keys);

  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  }, []);

  const reset = useCallback(() => {
    setDraft(baseline);
    setErrors({});
  }, [baseline]);

  const setError = useCallback((key: keyof T, message: string | undefined) => {
    setErrors((e) => ({ ...e, [key]: message }));
  }, []);

  return { draft, set, reset, dirty, errors, setErrors, setError };
}
