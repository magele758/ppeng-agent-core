'use client';

import { useCallback } from 'react';
import { defaultSubOf, subPagesOf, type SectionId } from '@/lib/nav';
import { useLab } from './LabProvider';

/** 当前 section 的子页状态；非当前 section 时返回其默认子页 */
export function useSectionNav(section: SectionId) {
  const { location, navigate } = useLab();
  const subs = subPagesOf(section);
  const sub =
    location.section === section && location.sub && subs.includes(location.sub)
      ? location.sub
      : defaultSubOf(section);
  const select = useCallback((next: string) => navigate(section, next), [navigate, section]);
  return { sub, select, subs };
}
