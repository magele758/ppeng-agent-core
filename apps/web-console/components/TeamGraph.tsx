'use client';

import { api } from '@/lib/api';
import { useI18n, type MessageKey } from '@/lib/i18n';
import type { SessionSummary } from '@/lib/types';
import {
  TEAM_GRAPH_LEGEND,
  TEAM_GRAPH_WORK_COLORS,
  activityFlowSeconds,
  activityMood,
  buildRiverPaths,
  countWorkingAgents,
  hexagonPoints,
  layoutHoneycomb,
  pickSwarmRun,
  resolveTaskWorkType,
  sessionIdFromArtifacts,
  swarmTaskToNode,
  type SwarmPlanRun,
  type SwarmPlanTask,
  type TeamGraphNode,
  type TeamGraphWorkType
} from '@/lib/team-graph';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

type Props = {
  sessions: SessionSummary[];
  redrawToken: number;
  active: boolean;
};

function workLegendLabel(
  type: (typeof TEAM_GRAPH_LEGEND)[number]['type'],
  t: (key: MessageKey) => string
): string {
  switch (type) {
    case 'tool':
      return t('teams.legendTool');
    case 'thinking':
      return t('teams.legendThinking');
    case 'outputting':
      return t('teams.legendOutput');
    case 'error':
      return t('teams.legendError');
    default: {
      const _never: never = type;
      return _never;
    }
  }
}

export function TeamGraph({ sessions, redrawToken, active }: Props) {
  const { t } = useI18n();
  const wrapRef = useRef<HTMLDivElement>(null);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const sessionKey = sessions.map((s) => `${s.id}:${s.status}`).join('|');
  const [size, setSize] = useState({ w: 800, h: 400 });
  const [run, setRun] = useState<SwarmPlanRun | null>(null);
  const [nodes, setNodes] = useState<TeamGraphNode[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const paintKey = useRef('');

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      setSize({ w: el.clientWidth || 800, h: el.clientHeight || 400 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [redrawToken]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const list = (await api('/api/swarm/runs')) as { runs?: SwarmPlanRun[] };
        const picked = pickSwarmRun(list.runs ?? []);
        if (!picked) {
          if (cancelled) return;
          const key = 'empty';
          if (paintKey.current !== key) {
            paintKey.current = key;
            setRun(null);
            setNodes([]);
            setLoadError(null);
          }
          return;
        }

        const detail = (await api(`/api/swarm/runs/${encodeURIComponent(picked.id)}`)) as {
          run?: SwarmPlanRun;
          tasks?: SwarmPlanTask[];
        };
        const tasks = detail.tasks ?? [];
        const sessionById = new Map(sessionsRef.current.map((s) => [s.id, s]));

        const resolved = await Promise.all(
          tasks.map(async (task) => {
            const sid = sessionIdFromArtifacts(task.artifacts);
            const sess = sid ? sessionById.get(sid) : undefined;
            let workType: TeamGraphWorkType = resolveTaskWorkType(task, sess?.status);
            const shouldProbe =
              sess?.status === 'running' ||
              (task.status === 'in_progress' && Boolean(sid) && sess?.status !== 'failed');
            if (shouldProbe && sid) {
              try {
                const snap = (await api(`/api/sessions/${encodeURIComponent(sid)}`)) as {
                  session?: { status?: string };
                  messages?: Array<{
                    role?: string;
                    parts?: Array<{ type?: string; text?: string; ok?: boolean }>;
                  }>;
                };
                workType = resolveTaskWorkType(task, snap.session?.status ?? sess?.status, snap.messages);
              } catch {
                /* keep coarse type */
              }
            }
            return swarmTaskToNode(task, workType);
          })
        );

        if (cancelled) return;
        const nextRun = detail.run ?? picked;
        const key = JSON.stringify({
          run: nextRun.id,
          status: nextRun.status,
          nodes: resolved.map((n) => [n.id, n.label, n.workType])
        });
        if (paintKey.current === key) return;
        paintKey.current = key;
        setRun(nextRun);
        setNodes(resolved);
        setLoadError(null);
      } catch (e) {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    };

    void load();
    if (!active) return () => {
      cancelled = true;
    };
    const timer = setInterval(() => void load(), 2800);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, redrawToken, sessionKey]);

  const layout = useMemo(
    () => layoutHoneycomb(nodes.length, size.w, size.h),
    [nodes.length, size.w, size.h]
  );
  const pos = useMemo(() => {
    const map: Record<string, { x: number; y: number }> = {};
    nodes.forEach((n, i) => {
      const p = layout.cells[i];
      if (p) map[n.id] = p;
    });
    return map;
  }, [nodes, layout.cells]);

  const emptyHint = loadError
    ? loadError
    : run
      ? t('teams.graphEmptyNoTasks')
      : t('teams.graphEmptyNoSwarm');

  const working = countWorkingAgents(nodes);
  const mood = activityMood(working);
  const flow = activityFlowSeconds(working);
  const rivers = useMemo(() => buildRiverPaths(size.w, size.h), [size.w, size.h]);
  const skyStyle = {
    '--team-flow-aurora': `${flow.aurora}s`,
    '--team-flow-drift': `${flow.flow}s`,
    '--team-flow-meteor': `${flow.meteor}s`
  } as CSSProperties;

  return (
    <div
      className={`graph-wrap graph-wrap--honeycomb graph-wrap--mood-${mood}`}
      id="teamGraph"
      ref={wrapRef}
      style={skyStyle}
      data-working={working}
    >
      <div className="team-graph-sky" aria-hidden="true">
        <div className="team-graph-aurora" />
        <div className="team-graph-veil" />
      </div>
      {run ? (
        <p className="team-graph-run">
          {run.status} · {run.goal}
        </p>
      ) : null}
      <svg
        id="teamSvg"
        className="team-graph-svg"
        xmlns="http://www.w3.org/2000/svg"
        aria-label={t('teams.graphAria')}
        viewBox={`0 0 ${size.w} ${size.h}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <g className="team-graph-rivers" aria-hidden="true">
          {rivers.map((r, i) => (
            <path
              key={i}
              className={`team-graph-river team-graph-river--${r.kind} team-graph-river--tone${r.tone}${r.reverse ? ' team-graph-river--rev' : ''}`}
              d={r.d}
              pathLength={1000}
              style={
                {
                  '--river-scale': String(r.scale),
                  '--river-delay': `calc(var(--team-flow-drift) * ${r.delay})`
                } as CSSProperties
              }
            />
          ))}
        </g>
        {nodes.length === 0 ? (
          <text className="graph-empty" x={size.w / 2} y={size.h / 2} textAnchor="middle">
            {emptyHint}
          </text>
        ) : (
          <>
            {nodes.map((n) =>
              n.blockedBy.map((dep) => {
                const a = pos[dep];
                const b = pos[n.id];
                if (!a || !b) return null;
                return (
                  <line
                    key={`${dep}->${n.id}`}
                    className="graph-edge--honey"
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                  />
                );
              })
            )}
            {nodes.map((n, i) => {
              const p = pos[n.id];
              if (!p) return null;
              return (
                <g key={n.id} className="graph-node" transform={`translate(${p.x} ${p.y})`}>
                  <title>
                    {n.label}
                    {n.sublabel ? ` · ${n.sublabel}` : ''} · {n.workType}
                  </title>
                  <polygon
                    className="graph-hex graph-hex--play"
                    points={hexagonPoints(0, 0, layout.hexR)}
                    stroke={TEAM_GRAPH_WORK_COLORS[n.workType]}
                    style={
                      {
                        color: TEAM_GRAPH_WORK_COLORS[n.workType],
                        '--hex-i': String(i),
                        '--hex-n': String(nodes.length)
                      } as CSSProperties
                    }
                  />
                  <text className="graph-label graph-label--honey" y={n.sublabel ? -3 : 4}>
                    {n.label}
                  </text>
                  {n.sublabel ? (
                    <text className="graph-sublabel graph-sublabel--honey" y={12}>
                      {n.sublabel}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </>
        )}
      </svg>
      <ul className="team-graph-legend" aria-label={t('teams.legendAria')}>
        {TEAM_GRAPH_LEGEND.map((item) => (
          <li key={item.type}>
            <span className="team-graph-legend__swatch" style={{ background: TEAM_GRAPH_WORK_COLORS[item.type] }} />
            {workLegendLabel(item.type, t)}
          </li>
        ))}
      </ul>
    </div>
  );
}
