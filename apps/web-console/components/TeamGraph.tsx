'use client';

import type { AgentInfo, MailItem, SessionSummary } from '@/lib/types';
import { useEffect, useRef } from 'react';

type Props = {
  agents: AgentInfo[];
  sessions: SessionSummary[];
  mail: MailItem[];
  redrawToken: number;
};

export function TeamGraph({ agents, sessions, mail, redrawToken }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const lastPaint = useRef<{ key: string; token: number }>({ key: '', token: -1 });

  useEffect(() => {
    const key = JSON.stringify({
      agents: agents.map((a) => a.id),
      sessions: sessions.map((s) => [s.id, s.agentId, s.mode]),
      mail: mail.map((m) => [m.fromAgentId, m.toAgentId])
    });
    if (lastPaint.current.key === key && lastPaint.current.token === redrawToken) return;
    lastPaint.current = { key, token: redrawToken };

    const svg = svgRef.current;
    if (!svg) return;
    const ns = 'http://www.w3.org/2000/svg';
    svg.innerHTML = '';
    const defs = document.createElementNS(ns, 'defs');
    defs.innerHTML = `<marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
    <polygon points="0 0, 8 3, 0 6" fill="rgba(34,211,238,0.8)" /></marker>`;
    svg.append(defs);

    const teammateAgents = new Set(sessions.filter((s) => s.mode === 'teammate').map((s) => s.agentId));
    const ids = [...new Set([...agents.map((a) => a.id), ...mail.flatMap((m) => [m.fromAgentId, m.toAgentId])])];
    if (ids.length === 0) {
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('x', '50%');
      t.setAttribute('y', '50%');
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('fill', '#a1a1aa');
      t.textContent = '暂无 Agent 数据';
      svg.append(t);
      return;
    }

    const w = svg.clientWidth || 800;
    const h = svg.clientHeight || 380;
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.32;
    const pos: Record<string, { x: number; y: number }> = {};
    ids.forEach((id, i) => {
      const ang = (i / ids.length) * Math.PI * 2 - Math.PI / 2;
      pos[id] = { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) };
    });

    const counts: Record<string, number> = {};
    for (const m of mail) {
      const k = `${m.fromAgentId}→${m.toAgentId}`;
      counts[k] = (counts[k] ?? 0) + 1;
    }
    for (const [k, n] of Object.entries(counts)) {
      const [from, to] = k.split('→');
      const a = pos[from];
      const b = pos[to];
      if (!a || !b) continue;
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', String(a.x));
      line.setAttribute('y1', String(a.y));
      line.setAttribute('x2', String(b.x));
      line.setAttribute('y2', String(b.y));
      line.setAttribute('class', `graph-edge${n <= 2 ? ' graph-edge-dim' : ''}`);
      line.setAttribute('stroke-width', String(1.5 + Math.min(n, 6)));
      svg.append(line);
      const midx = (a.x + b.x) / 2;
      const midy = (a.y + b.y) / 2;
      const lbl = document.createElementNS(ns, 'text');
      lbl.setAttribute('x', String(midx));
      lbl.setAttribute('y', String(midy - 4));
      lbl.setAttribute('class', 'graph-sublabel');
      lbl.textContent = String(n);
      svg.append(lbl);
    }

    for (const id of ids) {
      const { x, y } = pos[id];
      const g = document.createElementNS(ns, 'g');
      g.setAttribute('class', 'graph-node');
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', String(x));
      c.setAttribute('cy', String(y));
      c.setAttribute('r', teammateAgents.has(id) ? '28' : '24');
      c.setAttribute('class', `graph-node-circle${teammateAgents.has(id) ? ' teammate' : ''}`);
      const t1 = document.createElementNS(ns, 'text');
      t1.setAttribute('x', String(x));
      t1.setAttribute('y', String(y + 5));
      t1.setAttribute('class', 'graph-label');
      t1.textContent = id.length > 14 ? `${id.slice(0, 12)}…` : id;
      g.append(c, t1);
      svg.append(g);
    }
  }, [agents, sessions, mail, redrawToken]);

  return (
    <svg id="teamSvg" ref={svgRef} xmlns="http://www.w3.org/2000/svg" aria-label="Team graph" />
  );
}
