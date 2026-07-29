'use client';

import { api } from '@/lib/api';
import { useCallback, useEffect, useState } from 'react';

/** Compact global status: self-heal + evolution (does not steal Play focus). */
export function GlobalStatusBar() {
  const [healActive, setHealActive] = useState(0);
  const [evoActive, setEvoActive] = useState(0);

  const load = useCallback(async () => {
    try {
      const [heal, evo] = await Promise.all([
        api('/api/self-heal/status').catch(() => ({ active: [] })),
        api('/api/evolution/overview').catch(() => ({ activeWorktrees: [] }))
      ]);
      const h = heal as { active?: unknown[] };
      const e = evo as { activeWorktrees?: unknown[]; active?: unknown[] };
      setHealActive(Array.isArray(h.active) ? h.active.length : 0);
      const aw = e.activeWorktrees ?? e.active;
      setEvoActive(Array.isArray(aw) ? aw.length : 0);
    } catch {
      setHealActive(0);
      setEvoActive(0);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="global-status" aria-label="系统状态">
      <span className={`global-status__chip${healActive > 0 ? ' is-run' : ''}`}>
        heal {healActive > 0 ? healActive : 'idle'}
      </span>
      <a
        href="/evolution"
        className={`global-status__chip global-status__link${evoActive > 0 ? ' is-run' : ''}`}
        title="打开 Evolution 页"
      >
        evo {evoActive > 0 ? evoActive : 'idle'}
      </a>
    </div>
  );
}
