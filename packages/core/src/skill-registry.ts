import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import type { SkillSpec } from './types.js';

export function parseSkillFrontmatter(text: string): { meta: Record<string, string>; body: string } {
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

/** 同名时后者覆盖前者（用于 ~/.agents 覆盖仓库 skills）。 */
export function mergeSkillsByName(primary: SkillSpec[], override: SkillSpec[]): SkillSpec[] {
  const m = new Map<string, SkillSpec>();
  for (const s of primary) {
    m.set(s.name, s);
  }
  for (const s of override) {
    m.set(s.name, s);
  }
  return Array.from(m.values()).sort((left, right) => left.name.localeCompare(right.name));
}

async function loadSkillsFromTree(
  rootDir: string,
  source: NonNullable<SkillSpec['source']>,
  repoRootForRelative?: string
): Promise<SkillSpec[]> {
  try {
    const stack = [rootDir];
    const files: string[] = [];

    while (stack.length > 0) {
      const current = stack.pop() as string;
      let entries;
      try {
        entries = await readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }
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
      const parsed = parseSkillFrontmatter(text);
      const name = parsed.meta.name ?? (basename(dirname(file)) || `${source}-skill`);
      const relPath =
        repoRootForRelative && file.startsWith(repoRootForRelative)
          ? relative(repoRootForRelative, file)
          : undefined;
      skills.push({
        id: name,
        name,
        description: parsed.meta.description ?? `${source} skill`,
        content: parsed.body,
        promptFragment: parsed.body.slice(0, 4000),
        source,
        skillPath: relPath
      });
    }

    return skills.sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return [];
  }
}

export async function loadWorkspaceSkills(repoRoot: string): Promise<SkillSpec[]> {
  return loadSkillsFromTree(join(repoRoot, 'skills'), 'workspace', repoRoot);
}

/** 用户主目录下 ~/.agents 目录树中的 SKILL.md（或 RAW_AGENT_AGENTS_SKILLS_DIR）。RAW_AGENT_AGENTS_SKILLS=0 可关闭。 */
export async function loadAgentsDirSkills(): Promise<SkillSpec[]> {
  const off = String(process.env.RAW_AGENT_AGENTS_SKILLS ?? '').trim().toLowerCase();
  if (off === '0' || off === 'false' || off === 'no') {
    return [];
  }
  const root = process.env.RAW_AGENT_AGENTS_SKILLS_DIR?.trim() || join(homedir(), '.agents');
  return loadSkillsFromTree(root, 'agents');
}
