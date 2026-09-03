export type TeamGraphWorkType = 'idle' | 'tool' | 'thinking' | 'outputting' | 'error';

export type SwarmPlanTask = {
  id: string;
  title: string;
  status: string;
  requiredRole?: string;
  ownerAgentId?: string;
  artifacts?: string[];
  blockedBy?: string[];
};

export type SwarmPlanRun = {
  id: string;
  goal: string;
  status: string;
  strategy?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type TeamGraphNode = {
  id: string;
  label: string;
  sublabel: string;
  workType: TeamGraphWorkType;
  blockedBy: string[];
};

export const TEAM_GRAPH_WORK_COLORS: Record<TeamGraphWorkType, string> = {
  idle: '#64748b',
  tool: '#22d3ee',
  thinking: '#c084fc',
  outputting: '#4ade80',
  error: '#fb7185'
};

export const TEAM_GRAPH_LEGEND: Array<{ type: Exclude<TeamGraphWorkType, 'idle'>; label: string }> = [
  { type: 'tool', label: '工具调用' },
  { type: 'thinking', label: '思考' },
  { type: 'outputting', label: '输出' },
  { type: 'error', label: '错误' }
];

const ACTIVE_SWARM = new Set(['planning', 'running', 'reviewing']);

const HEX_DIRS: Array<[number, number]> = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1]
];

export function truncateLabel(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max - 1))}…`;
}

export function sessionIdFromArtifacts(artifacts: string[] | undefined): string | undefined {
  const tag = (artifacts ?? []).find((a) => a.startsWith('session:'));
  const id = tag?.slice('session:'.length).trim();
  return id || undefined;
}

export function pickSwarmRun<T extends SwarmPlanRun>(runs: T[]): T | null {
  if (!runs.length) return null;
  const live = runs.filter((r) => ACTIVE_SWARM.has(r.status));
  const pool = live.length ? live : runs;
  return (
    pool.slice().sort((a, b) => {
      const ta = a.updatedAt ?? a.createdAt ?? '';
      const tb = b.updatedAt ?? b.createdAt ?? '';
      return tb.localeCompare(ta);
    })[0] ?? null
  );
}

export function inferWorkType(
  status: string | undefined,
  messages:
    | Array<{
        role?: string;
        parts?: Array<{ type?: string; text?: string; ok?: boolean }>;
      }>
    | undefined
): TeamGraphWorkType {
  if (status === 'failed') return 'error';
  const working = status === 'running' || status === 'waiting_approval';
  if (!working) return 'idle';
  if (status === 'waiting_approval') return 'tool';

  const lastAsst = [...(messages ?? [])].reverse().find((m) => m.role === 'assistant');
  const parts = lastAsst?.parts ?? [];
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const p = parts[i]!;
    if (p.type === 'tool_call') return 'tool';
    if (p.type === 'tool_result' && p.ok === false) return 'error';
    if (p.type === 'reasoning') return 'thinking';
    if (p.type === 'text' && (p.text ?? '').trim()) return 'outputting';
  }
  return 'thinking';
}

export function resolveTaskWorkType(
  task: Pick<SwarmPlanTask, 'status'>,
  sessionStatus: string | undefined,
  messages?: Parameters<typeof inferWorkType>[1]
): TeamGraphWorkType {
  if (task.status === 'failed' || sessionStatus === 'failed') return 'error';
  if (sessionStatus === 'running' || sessionStatus === 'waiting_approval') {
    return inferWorkType(sessionStatus, messages);
  }
  if (task.status === 'in_progress' || task.status === 'claimed') return 'thinking';
  return 'idle';
}

export type TeamGraphMood = 'calm' | 'low' | 'mid' | 'hot';

const WORKING_TYPES = new Set<TeamGraphWorkType>(['tool', 'thinking', 'outputting', 'error']);

export function countWorkingAgents(nodes: Array<{ workType: TeamGraphWorkType }>): number {
  return nodes.reduce((n, node) => n + (WORKING_TYPES.has(node.workType) ? 1 : 0), 0);
}

/** 0 / 1 / few (2–3) / many (4+) */
export function activityMood(working: number): TeamGraphMood {
  if (working <= 0) return 'calm';
  if (working === 1) return 'low';
  if (working <= 3) return 'mid';
  return 'hot';
}

export function activityFlowSeconds(working: number): { aurora: number; flow: number; meteor: number } {
  if (working <= 0) return { aurora: 40, flow: 32, meteor: 16 };
  if (working === 1) return { aurora: 26, flow: 20, meteor: 11 };
  if (working <= 3) return { aurora: 16, flow: 12, meteor: 7 };
  return { aurora: 9, flow: 6.5, meteor: 4.2 };
}

export type TeamGraphRiver = {
  kind: 'wide' | 'mid' | 'needle';
  tone: '1' | '2' | '3';
  reverse: boolean;
  scale: number;
  delay: number;
  d: string;
};

/** Full-bleed cubic Beziers that bend around the honeycomb, mixed L→R / R→L. */
export function buildRiverPaths(w: number, h: number): TeamGraphRiver[] {
  const X = (p: number) => (p / 100) * w;
  const Y = (p: number) => (p / 100) * h;
  const M = (x: number, y: number) => `M ${X(x).toFixed(1)} ${Y(y).toFixed(1)}`;
  const C = (x1: number, y1: number, x2: number, y2: number, x: number, y: number) =>
    `C ${X(x1).toFixed(1)} ${Y(y1).toFixed(1)}, ${X(x2).toFixed(1)} ${Y(y2).toFixed(1)}, ${X(x).toFixed(1)} ${Y(y).toFixed(1)}`;
  return [
    { kind: 'wide', tone: '1', reverse: false, scale: 1.4, delay: -0.08, d: `${M(-14, 20)} ${C(24, -16, 52, 78, 114, 26)}` },
    { kind: 'wide', tone: '2', reverse: true, scale: 1.62, delay: -0.44, d: `${M(114, 82)} ${C(70, 118, 32, 18, -12, 68)}` },
    { kind: 'mid', tone: '1', reverse: false, scale: 1.08, delay: -0.16, d: `${M(-10, 48)} ${C(28, 4, 64, 96, 112, 38)}` },
    { kind: 'mid', tone: '2', reverse: true, scale: 0.98, delay: -0.52, d: `${M(110, 10)} ${C(68, 54, 36, -12, -8, 56)}` },
    { kind: 'mid', tone: '3', reverse: false, scale: 1.18, delay: -0.3, d: `${M(6, 114)} ${C(-10, 58, 96, 14, 82, -12)}` },
    { kind: 'needle', tone: '1', reverse: false, scale: 0.78, delay: -0.06, d: `${M(-8, 6)} ${C(30, 42, 76, -10, 110, 22)}` },
    { kind: 'needle', tone: '2', reverse: true, scale: 0.6, delay: -0.26, d: `${M(112, 64)} ${C(76, 98, 22, 44, -8, 90)}` },
    { kind: 'needle', tone: '3', reverse: false, scale: 0.7, delay: -0.4, d: `${M(-6, 94)} ${C(40, 116, 88, 6, 106, 2)}` },
    { kind: 'needle', tone: '1', reverse: true, scale: 0.86, delay: -0.62, d: `${M(50, -14)} ${C(122, 30, -12, 72, 46, 116)}` }
  ];
}

export function swarmTaskToNode(task: SwarmPlanTask, workType: TeamGraphWorkType): TeamGraphNode {
  const rawLabel = (task.ownerAgentId || task.requiredRole || task.title || task.id).trim();
  const rawSub = task.title && task.title !== rawLabel ? task.title : task.status;
  return {
    id: task.id,
    label: truncateLabel(rawLabel, 14),
    sublabel: truncateLabel(rawSub, 16),
    workType: task.status === 'failed' ? 'error' : workType,
    blockedBy: task.blockedBy ?? []
  };
}

export function hexSpiral(count: number): Array<{ q: number; r: number }> {
  if (count <= 0) return [];
  const cells = [{ q: 0, r: 0 }];
  let ring = 1;
  while (cells.length < count) {
    let q = HEX_DIRS[4]![0] * ring;
    let r = HEX_DIRS[4]![1] * ring;
    for (let d = 0; d < 6 && cells.length < count; d += 1) {
      const dir = HEX_DIRS[d]!;
      for (let step = 0; step < ring && cells.length < count; step += 1) {
        cells.push({ q, r });
        q += dir[0];
        r += dir[1];
      }
    }
    ring += 1;
  }
  return cells;
}

export function hexagonPoints(cx: number, cy: number, radius: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${cx + radius * Math.cos(a)},${cy + radius * Math.sin(a)}`);
  }
  return pts.join(' ');
}

export function layoutHoneycomb(
  count: number,
  width: number,
  height: number
): { cells: Array<{ x: number; y: number }>; hexR: number } {
  const cells = hexSpiral(count);
  if (!cells.length) return { cells: [], hexR: 28 };

  const pad = 36;
  const availW = Math.max(120, width - pad * 2);
  const availH = Math.max(120, height - pad * 2);
  const raw = cells.map((c) => ({
    x: Math.sqrt(3) * (c.q + c.r / 2),
    y: (3 / 2) * c.r
  }));
  const xs = raw.map((p) => p.x);
  const ys = raw.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const size = Math.min(50, Math.max(24, Math.min(availW / (spanX + 2), availH / (spanY + 2))));
  const hexR = size * 0.86;
  const cx = width / 2;
  const cy = height / 2;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  return {
    hexR,
    cells: raw.map((p) => ({
      x: cx + (p.x - midX) * size,
      y: cy + (p.y - midY) * size
    }))
  };
}
