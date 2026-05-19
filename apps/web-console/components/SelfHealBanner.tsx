'use client';

import { api } from '@/lib/api';
import { useCallback, useEffect, useState } from 'react';

export function SelfHealBanner() {
  const [activeCount, setActiveCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = (await api('/api/self-heal/status')) as { active?: unknown[] };
      setActiveCount(Array.isArray(res.active) ? res.active.length : 0);
    } catch {
      setActiveCount(0);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="muted" style={{ fontSize: '0.8rem', padding: '0 0.5rem' }}>
      Self-heal: {activeCount > 0 ? `${activeCount} 个活动 run` : '空闲'}
    </div>
  );
}
