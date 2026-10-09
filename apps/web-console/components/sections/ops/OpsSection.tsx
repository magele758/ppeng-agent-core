'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { OpsPanel } from '../../OpsPanel';
import { useLab } from '../../shell/LabProvider';
import { SectionFrame } from '../SectionFrame';
import { HealthView } from './HealthView';
import './ops.css';

type TraceRow = { kind: string; ts: string; payload: unknown };

function TrajectoryView() {
  const { sessions, selectedSessionId, openSession } = useLab();
  const [traceRows, setTraceRows] = useState<TraceRow[]>([]);

  const loadTrace = useCallback(async () => {
    if (!selectedSessionId) {
      setTraceRows([]);
      return;
    }
    const el = document.getElementById('traceTimeline');
    const top = el?.scrollTop ?? 0;
    try {
      const { events } = (await api(
        `/api/traces?sessionId=${encodeURIComponent(selectedSessionId)}&limit=500`
      )) as { events?: TraceRow[] };
      setTraceRows(events ?? []);
    } catch {
      setTraceRows([]);
    }
    requestAnimationFrame(() => {
      const next = document.getElementById('traceTimeline');
      if (next) next.scrollTop = top;
    });
  }, [selectedSessionId]);

  useEffect(() => {
    setTraceRows([]);
  }, [selectedSessionId]);

  useEffect(() => {
    void loadTrace();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadTrace();
    }, 3000);
    return () => clearInterval(timer);
  }, [loadTrace]);

  return (
    <OpsPanel
      active
      sessions={sessions}
      selectedSessionId={selectedSessionId}
      onSelectSession={(id) => void openSession(id)}
      traceRows={traceRows}
    />
  );
}

export function OpsSection({ active }: { active: boolean }) {
  return (
    <SectionFrame
      section="ops"
      active={active}
      renderSub={(sub) => {
        switch (sub) {
          case 'trajectory':
            return <TrajectoryView />;
          case 'health':
            return <HealthView />;
          default:
            return null;
        }
      }}
    />
  );
}
