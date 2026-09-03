import { edgesFromTasks, evaluateTeamPlanDag, mergeDependsOnFromEdges } from './dag.js';
import type { TeamDagEdge, TeamDagRole, TeamDagTask, TeamPlannerSource } from './types.js';

export interface TeamPlannerInput {
  objective: string;
  completeText?: (input: { system: string; user: string }) => Promise<string>;
  useLlm?: boolean;
}

export interface TeamPlannerResult {
  tasks: TeamDagTask[];
  edges: TeamDagEdge[];
  source: TeamPlannerSource;
}

const PLANNER_SYSTEM = [
  'You are an independent Planner. Split the user objective into a generic multi-agent DAG.',
  'Return JSON only: {"tasks":[{"id":"t1","title":"...","description":"...","dependsOn":[],"role":"worker"}]}',
  'Rules: unique ids, dependsOn must reference other task ids, at least one root (empty dependsOn), no cycles.',
  'Roles: worker | reviewer | coordinator. Do not use industry or product-specific gate names.',
  'Prefer 2–6 tasks. Parallelize when there is no real dependency.'
].join(' ');

export function heuristicTasksForObjective(objective: string): TeamDagTask[] {
  const goal = objective.trim() || 'untitled';
  return [
    {
      id: 'analyze',
      title: '分析与拆解',
      description: `澄清目标、约束与交付物：${goal}`,
      dependsOn: [],
      role: 'worker',
      status: 'pending'
    },
    {
      id: 'execute',
      title: '执行',
      description: `按分析结果推进：${goal}`,
      dependsOn: ['analyze'],
      role: 'worker',
      status: 'pending'
    }
  ];
}

export function mapRawTasks(raw: unknown): TeamDagTask[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw.map((item, i) => {
    const o = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : `t${i + 1}`;
    const roleRaw = typeof o.role === 'string' ? o.role : 'worker';
    const role: TeamDagRole =
      roleRaw === 'planner' || roleRaw === 'coordinator' || roleRaw === 'reviewer' ? roleRaw : 'worker';
    return {
      id,
      title: typeof o.title === 'string' && o.title.trim() ? o.title.trim() : id,
      description: typeof o.description === 'string' ? o.description : undefined,
      dependsOn: Array.isArray(o.dependsOn) ? o.dependsOn.map(String).filter(Boolean) : [],
      role,
      status: 'pending' as const
    };
  });
}

export function normalizePlannerTasks(raw: unknown, _objective?: string): TeamDagTask[] | null {
  const tasks = mapRawTasks(raw);
  if (!tasks) return null;
  return evaluateTeamPlanDag(tasks).ok ? tasks : null;
}

export function parsePlannerJson(text: string): unknown {
  const trimmed = (text || '').trim().replace(/^```json\s*|```$/g, '').trim();
  if (!trimmed) return undefined;
  try {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    const slice = start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
    return JSON.parse(slice);
  } catch {
    return undefined;
  }
}

export async function planTeamObjective(input: TeamPlannerInput): Promise<TeamPlannerResult> {
  const objective = input.objective.trim() || 'untitled';
  if (input.useLlm !== false && input.completeText) {
    try {
      const text = await input.completeText({
        system: PLANNER_SYSTEM,
        user: `Objective:\n${objective}\n\nSubmit the DAG JSON.`
      });
      const parsed = parsePlannerJson(text || '');
      const obj = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
      const tasks = obj ? normalizePlannerTasks(obj.tasks, objective) : null;
      if (tasks) {
        if (Array.isArray(obj?.edges)) {
          mergeDependsOnFromEdges(
            tasks,
            obj.edges.filter((e): e is TeamDagEdge => Boolean(e && typeof e === 'object'))
          );
        }
        const dag = evaluateTeamPlanDag(tasks);
        if (dag.ok) {
          return { tasks, edges: edgesFromTasks(tasks), source: 'llm' };
        }
      }
    } catch {
      /* fail-soft → heuristic */
    }
  }
  const tasks = heuristicTasksForObjective(objective);
  return { tasks, edges: edgesFromTasks(tasks), source: 'heuristic' };
}
