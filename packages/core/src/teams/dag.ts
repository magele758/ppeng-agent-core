export const TEAM_PLAN_DAG_ERROR_PREFIX = 'DAG 评估未通过';

export interface TeamPlanDagTask {
  id: string;
  dependsOn?: string[];
}

export interface TeamPlanDagIssue {
  kind: 'empty' | 'blank_id' | 'duplicate_id' | 'dangling' | 'self_dep' | 'cycle' | 'no_root';
  message: string;
}

export class DependencyGraph {
  private deps: Array<{ from: string; to: string }> = [];
  private taskIds = new Set<string>();

  addTask(taskId: string): void {
    this.taskIds.add(taskId);
  }

  addDependency(fromTaskId: string, toTaskId: string): void {
    this.deps.push({ from: fromTaskId, to: toTaskId });
    this.taskIds.add(fromTaskId);
    this.taskIds.add(toTaskId);
  }

  getPredecessors(taskId: string): string[] {
    return [...new Set(this.deps.filter((d) => d.to === taskId).map((d) => d.from))];
  }

  getSuccessors(taskId: string): string[] {
    return [...new Set(this.deps.filter((d) => d.from === taskId).map((d) => d.to))];
  }

  getReadyTasks(completed: Set<string>, excluded: Set<string> = new Set()): string[] {
    const ready: string[] = [];
    for (const tid of this.taskIds) {
      if (completed.has(tid) || excluded.has(tid)) continue;
      const preds = this.getPredecessors(tid);
      if (preds.every((p) => completed.has(p))) ready.push(tid);
    }
    return ready;
  }

  hasCycle(): boolean {
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const visit = (taskId: string): boolean => {
      visited.add(taskId);
      recStack.add(taskId);
      for (const succ of this.getSuccessors(taskId)) {
        if (!visited.has(succ)) {
          if (visit(succ)) return true;
        } else if (recStack.has(succ)) {
          return true;
        }
      }
      recStack.delete(taskId);
      return false;
    };

    for (const tid of this.taskIds) {
      if (!visited.has(tid) && visit(tid)) return true;
    }
    return false;
  }
}

export function validateTeamPlanDag(tasks: TeamPlanDagTask[]): TeamPlanDagIssue[] {
  const issues: TeamPlanDagIssue[] = [];
  if (!Array.isArray(tasks) || tasks.length === 0) {
    issues.push({ kind: 'empty', message: 'tasks 为空，没有可执行子任务' });
    return issues;
  }

  const idSet = new Set<string>();
  const dupes = new Set<string>();
  for (const task of tasks) {
    const id = typeof task.id === 'string' ? task.id.trim() : '';
    if (!id) {
      issues.push({ kind: 'blank_id', message: '存在空任务 id' });
      continue;
    }
    if (idSet.has(id)) dupes.add(id);
    idSet.add(id);
  }
  if (dupes.size > 0) {
    issues.push({ kind: 'duplicate_id', message: `任务 id 重复：${[...dupes].join(', ')}` });
  }

  const existing = [...idSet].join(', ');
  for (const task of tasks) {
    const id = typeof task.id === 'string' ? task.id.trim() : '';
    if (!id) continue;
    for (const rawDep of task.dependsOn ?? []) {
      const dep = typeof rawDep === 'string' ? rawDep.trim() : '';
      if (!dep) {
        issues.push({ kind: 'dangling', message: `${id}.dependsOn 含空字符串` });
        continue;
      }
      if (dep === id) {
        issues.push({ kind: 'self_dep', message: `${id}.dependsOn 包含自己` });
        continue;
      }
      if (!idSet.has(dep)) {
        issues.push({
          kind: 'dangling',
          message: `${id}.dependsOn 引用了不存在的任务 "${dep}"（现有 id: ${existing}）`
        });
      }
    }
  }

  const graph = new DependencyGraph();
  for (const id of idSet) graph.addTask(id);
  for (const task of tasks) {
    const id = typeof task.id === 'string' ? task.id.trim() : '';
    if (!id) continue;
    for (const rawDep of task.dependsOn ?? []) {
      const dep = typeof rawDep === 'string' ? rawDep.trim() : '';
      if (dep && idSet.has(dep) && dep !== id) {
        graph.addDependency(dep, id);
      }
    }
  }
  if (graph.hasCycle()) {
    issues.push({ kind: 'cycle', message: '任务依赖存在环' });
  }

  const hasRoot = tasks.some((task) => {
    const id = typeof task.id === 'string' ? task.id.trim() : '';
    if (!id) return false;
    return !(task.dependsOn?.filter((d) => typeof d === 'string' && d.trim()).length);
  });
  if (!hasRoot && !issues.some((i) => i.kind === 'cycle' || i.kind === 'dangling' || i.kind === 'empty')) {
    issues.push({ kind: 'no_root', message: '没有任何 dependsOn=[] 的根任务，无法开始调度' });
  }

  return issues;
}

export function formatTeamPlanDagError(issues: TeamPlanDagIssue[]): string {
  const body = issues.map((issue) => `- ${issue.message}`).join('\n');
  return `${TEAM_PLAN_DAG_ERROR_PREFIX}：\n${body}`;
}

export function evaluateTeamPlanDag(
  tasks: TeamPlanDagTask[]
): { ok: true } | { ok: false; issues: TeamPlanDagIssue[]; detail: string } {
  const issues = validateTeamPlanDag(tasks);
  if (issues.length === 0) return { ok: true };
  return { ok: false, issues, detail: formatTeamPlanDagError(issues) };
}

export function graphFromTasks(tasks: TeamPlanDagTask[]): DependencyGraph {
  const graph = new DependencyGraph();
  for (const task of tasks) {
    const id = task.id.trim();
    if (id) graph.addTask(id);
  }
  for (const task of tasks) {
    const id = task.id.trim();
    for (const dep of task.dependsOn ?? []) {
      const d = dep.trim();
      if (id && d && d !== id) graph.addDependency(d, id);
    }
  }
  return graph;
}

export function edgesFromTasks(tasks: TeamPlanDagTask[]): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  const seen = new Set<string>();
  for (const task of tasks) {
    const to = typeof task.id === 'string' ? task.id.trim() : '';
    if (!to) continue;
    for (const raw of task.dependsOn ?? []) {
      const from = typeof raw === 'string' ? raw.trim() : '';
      if (!from || from === to) continue;
      const key = `${from}->${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from, to });
    }
  }
  return edges;
}

export function mergeDependsOnFromEdges(
  tasks: TeamPlanDagTask[],
  edges: Array<{ from: string; to: string }> | undefined
): void {
  if (!edges?.length) return;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const edge of edges) {
    const from = typeof edge.from === 'string' ? edge.from.trim() : '';
    const to = typeof edge.to === 'string' ? edge.to.trim() : '';
    const task = byId.get(to);
    if (!from || !to || !task || from === to) continue;
    if (!task.dependsOn) task.dependsOn = [];
    if (!task.dependsOn.includes(from)) task.dependsOn.push(from);
  }
}
