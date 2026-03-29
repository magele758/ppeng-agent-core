import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SkillSpec } from './types.js';

export const builtinSkills: SkillSpec[] = [
  {
    id: 'planning',
    name: 'Planning',
    description: 'Use TodoWrite for multi-step work and keep exactly one item in progress.',
    promptFragment: 'Break substantial work into a tracked todo list before making broad changes.',
    triggerWords: ['plan', 'roadmap', 'steps', 'todo'],
    source: 'builtin'
  },
  {
    id: 'subagents',
    name: 'Subagents',
    description: 'Use spawn_subagent for bounded exploration or isolated implementation work.',
    promptFragment: 'Delegate only concrete, bounded tasks that benefit from clean context.',
    triggerWords: ['delegate', 'subagent', 'parallel', 'research'],
    source: 'builtin'
  },
  {
    id: 'skills',
    name: 'Skills',
    description: 'Load workspace skills only when they are relevant.',
    promptFragment: 'Use load_skill instead of front-loading large reference documents.',
    triggerWords: ['skill', 'guide', 'reference'],
    source: 'builtin'
  },
  {
    id: 'compression',
    name: 'Compression',
    description: 'Compact context when sessions become large and preserve continuity in summaries.',
    promptFragment: 'Keep context lean. Summaries should preserve active tasks, decisions, and risks.',
    triggerWords: ['compact', 'summary', 'context'],
    source: 'builtin'
  },
  {
    id: 'tasks',
    name: 'Tasks',
    description: 'Represent long-lived work as persistent tasks with dependencies.',
    promptFragment: 'Use task_create, task_update, and task_list for durable multi-step work.',
    triggerWords: ['task', 'dependency', 'blocked'],
    source: 'builtin'
  },
  {
    id: 'team',
    name: 'Team',
    description: 'Use teammates and mailbox messages for asynchronous coordination.',
    promptFragment: 'When work is truly parallelizable, spawn_teammate and send_message with clear ownership.',
    triggerWords: ['team', 'teammate', 'mailbox', 'handoff'],
    source: 'builtin'
  },
  {
    id: 'harness-long-running',
    name: 'Long-running harness',
    description:
      'Anthropic-style planner / generator / evaluator loop: spec, sprint contracts, external QA, structured artifacts.',
    promptFragment:
      'For multi-hour or multi-feature builds: (1) Planner expands a short prompt into a high-level product spec—deliverables and sprint-sized chunks, not fragile low-level API details. (2) Generator implements one sprint at a time; before code, agree a sprint contract (scope + testable acceptance criteria); after implementation, prefer spawn_subagent(role=evaluator) or role=review for verification. (3) Evaluator is skeptical, checks edge cases, and records feedback—do not rubber-stamp. Use harness_write_spec for product_spec, sprint_contract, and evaluator_feedback under .raw-agent-harness/. Use task_create with blockedBy for feature ordering. On huge contexts, rely on compaction plus these files for handoff.',
    triggerWords: ['harness', 'sprint', 'planner', 'evaluator', 'long-running', 'spec', 'contract'],
    source: 'builtin'
  }
];

export function matchSkills(goal: string, skills = builtinSkills): SkillSpec[] {
  const lowerGoal = goal.toLowerCase();
  return skills.filter((skill) => skill.triggerWords?.some((word) => lowerGoal.includes(word)));
}

function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  if (!text.startsWith('---\n')) {
    return { meta: {}, body: text.trim() };
  }

  const end = text.indexOf('\n---\n', 4);
  if (end === -1) {
    return { meta: {}, body: text.trim() };
  }

  const rawMeta = text.slice(4, end).trim().split('\n');
  const meta: Record<string, string> = {};
  for (const line of rawMeta) {
    const [key, ...rest] = line.split(':');
    if (!key || rest.length === 0) continue;
    meta[key.trim()] = rest.join(':').trim();
  }

  return {
    meta,
    body: text.slice(end + '\n---\n'.length).trim()
  };
}

export async function loadWorkspaceSkills(repoRoot: string): Promise<SkillSpec[]> {
  const root = join(repoRoot, 'skills');
  try {
    const stack = [root];
    const files: string[] = [];

    while (stack.length > 0) {
      const current = stack.pop() as string;
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
        } else if (entry.isFile() && entry.name === 'SKILL.md') {
          files.push(fullPath);
        }
      }
    }

    const skills: SkillSpec[] = [];

    for (const file of files) {
      const text = await readFile(file, 'utf8');
      const parsed = parseFrontmatter(text);
      const name = parsed.meta.name ?? file.split('/').slice(-2, -1)[0] ?? 'workspace-skill';
      skills.push({
        id: name,
        name,
        description: parsed.meta.description ?? 'Workspace skill',
        content: parsed.body,
        promptFragment: parsed.body.slice(0, 4000),
        source: 'workspace'
      });
    }

    return skills.sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return [];
  }
}
