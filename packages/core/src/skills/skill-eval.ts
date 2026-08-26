/**
 * SkillEvalEngine: Evaluation and benchmark service for Skill Routing & Quality.
 * Provides quantitative metrics (Pass Rate, Top-1 Precision, Top-K Recall, MRR, Latency)
 * and synthetic test case generation.
 */

import { buildSkillRouting, buildSkillRoutingWithFusion, type SkillRoutingMode } from './skill-router.js';
import { loadAllSkills } from './builtin-skills.js';
import type { SkillSpec } from '../types.js';

export interface SkillEvalTestCase {
  id: string;
  query: string;
  topShouldInclude: string;
  category?: string;
  description?: string;
}

export interface SkillEvalResultCase {
  testCase: SkillEvalTestCase;
  passed: boolean;
  actualShortlist: string[];
  rank: number; // 1-indexed, -1 if not found
  scoreGap?: number;
  confidenceLevel?: string;
  latencyMs: number;
}

export interface SkillEvalSummary {
  mode: SkillRoutingMode;
  topK: number;
  useFusion: boolean;
  totalCases: number;
  passedCases: number;
  passRate: number; // 0.0 ~ 1.0
  top1Precision: number; // 0.0 ~ 1.0
  top3Recall: number; // 0.0 ~ 1.0
  mrr: number; // Mean Reciprocal Rank (0.0 ~ 1.0)
  averageLatencyMs: number;
  timestamp: string;
  details: SkillEvalResultCase[];
}

export interface SkillEvalOptions {
  mode?: SkillRoutingMode;
  topK?: number;
  useFusion?: boolean;
  skills?: SkillSpec[];
  testCases?: SkillEvalTestCase[];
}

export interface MultiModeSkillEvalResult {
  timestamp: string;
  totalSkillsCount: number;
  totalCasesCount: number;
  summaries: Record<string, SkillEvalSummary>;
}

/**
 * Default fallback evaluation cases if none are provided.
 */
export const DEFAULT_SKILL_EVAL_CASES: SkillEvalTestCase[] = [
  {
    id: 'case-postgres',
    query: 'optimize slow postgres query and indexes',
    topShouldInclude: 'Postgres Tuning',
    category: 'database'
  },
  {
    id: 'case-mermaid',
    query: 'I need to render a mermaid flowchart to SVG',
    topShouldInclude: 'Pretty Mermaid',
    category: 'tools'
  },
  {
    id: 'case-skill-authoring',
    query: 'create a new Cursor agent skill with SKILL.md',
    topShouldInclude: 'Skill Authoring',
    category: 'development'
  },
  {
    id: 'case-lark-mail',
    query: 'compose email in feishu inbox',
    topShouldInclude: 'Lark Mail',
    category: 'communication'
  },
  {
    id: 'case-playwright',
    query: 'playwright browser automation CI e2e',
    topShouldInclude: 'Playwright E2E',
    category: 'testing'
  },
  {
    id: 'case-git',
    query: 'git rebase instead of messy merge conflict',
    topShouldInclude: 'Git Workflow',
    category: 'development'
  },
  {
    id: 'case-docker',
    query: 'docker compose production Dockerfile smaller image',
    topShouldInclude: 'Docker Deploy',
    category: 'devops'
  },
  {
    id: 'case-feishu-calendar',
    query: '飞书日历查询忙闲会议',
    topShouldInclude: 'Feishu Calendar',
    category: 'communication'
  },
  {
    id: 'case-python-conda',
    query: 'conda create virtualenv avoid global pip',
    topShouldInclude: 'Python Conda',
    category: 'environment'
  },
  {
    id: 'case-subagent',
    query: 'spawn subagent parallel research delegate',
    topShouldInclude: 'Subagent Tips',
    category: 'agent-core'
  }
];

/**
 * Generate synthetic evaluation test cases dynamically from loaded skill specifications.
 */
export function generateSyntheticTestCases(skills: SkillSpec[]): SkillEvalTestCase[] {
  const cases: SkillEvalTestCase[] = [];

  for (let i = 0; i < skills.length; i++) {
    const skill = skills[i]!;

    // 1. Generate case from trigger words if present
    if (skill.triggerWords && skill.triggerWords.length > 0) {
      const trigger = skill.triggerWords[0]!;
      cases.push({
        id: `synth-trigger-${i}-${skill.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        query: `How do I handle ${trigger} using ${skill.name}?`,
        topShouldInclude: skill.name,
        category: 'synthetic-trigger',
        description: `Synthetic test case from trigger word '${trigger}'`
      });
    }

    // 2. Generate case from description
    if (skill.description && skill.description.length > 5) {
      const descSnippet = skill.description.slice(0, 60);
      cases.push({
        id: `synth-desc-${i}-${skill.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        query: `I need help with: ${descSnippet}`,
        topShouldInclude: skill.name,
        category: 'synthetic-description',
        description: `Synthetic test case from skill description`
      });
    }

    // 3. Generate case from alias if present
    if (skill.aliases && skill.aliases.length > 0) {
      const alias = skill.aliases[0]!;
      cases.push({
        id: `synth-alias-${i}-${skill.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        query: `Execute task using ${alias}`,
        topShouldInclude: skill.name,
        category: 'synthetic-alias',
        description: `Synthetic test case from alias '${alias}'`
      });
    }
  }

  return cases;
}

/**
 * Execute a single Skill Evaluation run.
 */
export async function runSkillEval(options: SkillEvalOptions = {}): Promise<SkillEvalSummary> {
  const mode = options.mode ?? 'hybrid';
  const topK = options.topK ?? 5;
  const useFusion = options.useFusion ?? false;

  const skills = options.skills ?? (await loadAllSkills());
  const cases = options.testCases ?? DEFAULT_SKILL_EVAL_CASES;

  let totalPassed = 0;
  let top1Hits = 0;
  let top3Hits = 0;
  let reciprocalRankSum = 0;
  let totalLatencyMs = 0;

  const details: SkillEvalResultCase[] = [];

  for (const tc of cases) {
    const startTime = performance.now();
    const result = useFusion
      ? buildSkillRoutingWithFusion(tc.query, skills, { mode, topK, useFusion: true })
      : buildSkillRouting(tc.query, skills, { mode, topK });
    const endTime = performance.now();
    const latencyMs = Math.round((endTime - startTime) * 100) / 100;
    totalLatencyMs += latencyMs;

    const shortlist = result.shortlistNames;
    const targetNameLower = tc.topShouldInclude.toLowerCase();

    const matchedIndex = shortlist.findIndex(
      (name) => name.toLowerCase() === targetNameLower || name.toLowerCase().includes(targetNameLower) || targetNameLower.includes(name.toLowerCase())
    );

    const rank = matchedIndex >= 0 ? matchedIndex + 1 : -1;
    const passed = rank >= 1 && rank <= topK;

    if (passed) {
      totalPassed++;
    }
    if (rank === 1) {
      top1Hits++;
    }
    if (rank >= 1 && rank <= 3) {
      top3Hits++;
    }

    if (rank > 0) {
      reciprocalRankSum += 1 / rank;
    }

    details.push({
      testCase: tc,
      passed,
      actualShortlist: shortlist,
      rank,
      scoreGap: result.confidence.scoreGap,
      confidenceLevel: result.confidence.level,
      latencyMs
    });
  }

  const totalCases = cases.length;
  const passRate = totalCases > 0 ? Math.round((totalPassed / totalCases) * 1000) / 1000 : 0;
  const top1Precision = totalCases > 0 ? Math.round((top1Hits / totalCases) * 1000) / 1000 : 0;
  const top3Recall = totalCases > 0 ? Math.round((top3Hits / totalCases) * 1000) / 1000 : 0;
  const mrr = totalCases > 0 ? Math.round((reciprocalRankSum / totalCases) * 1000) / 1000 : 0;
  const averageLatencyMs = totalCases > 0 ? Math.round((totalLatencyMs / totalCases) * 100) / 100 : 0;

  return {
    mode,
    topK,
    useFusion,
    totalCases,
    passedCases: totalPassed,
    passRate,
    top1Precision,
    top3Recall,
    mrr,
    averageLatencyMs,
    timestamp: new Date().toISOString(),
    details
  };
}

/**
 * Compare multiple routing modes (e.g. legacy vs lexical vs hybrid vs fusion) in a single run.
 */
export async function compareSkillEvalModes(
  options: Omit<SkillEvalOptions, 'mode'> & { modes?: SkillRoutingMode[] } = {}
): Promise<MultiModeSkillEvalResult> {
  const modes = options.modes ?? ['legacy', 'lexical', 'hybrid'];
  const skills = options.skills ?? (await loadAllSkills());
  const cases = options.testCases ?? DEFAULT_SKILL_EVAL_CASES;

  const summaries: Record<string, SkillEvalSummary> = {};

  for (const mode of modes) {
    summaries[mode] = await runSkillEval({
      ...options,
      mode,
      skills,
      testCases: cases,
      useFusion: false
    });
  }

  // Also include fusion run for comparison
  summaries['hybrid-fusion'] = await runSkillEval({
    ...options,
    mode: 'hybrid',
    useFusion: true,
    skills,
    testCases: cases
  });

  return {
    timestamp: new Date().toISOString(),
    totalSkillsCount: skills.length,
    totalCasesCount: cases.length,
    summaries
  };
}
