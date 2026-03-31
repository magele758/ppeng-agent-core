import type { SkillSpec } from './types.js';
import { matchSkills } from './builtin-skills.js';

export type SkillRoutingMode = 'legacy' | 'lexical' | 'hybrid';

const BODY_SLICE = 24_000;

function normalizeEnvMode(raw: string | undefined): SkillRoutingMode {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'legacy' || v === 'lexical' || v === 'hybrid') {
    return v;
  }
  return 'hybrid';
}

/** 路由模式：legacy=旧行为；lexical=仅全文词法 shortlist；hybrid=词法 shortlist ∪ trigger 命中 */
export function skillRoutingModeFromEnv(env: NodeJS.ProcessEnv = process.env): SkillRoutingMode {
  return normalizeEnvMode(env.RAW_AGENT_SKILL_ROUTING_MODE);
}

export function skillRoutingTopKFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const v = Number(env.RAW_AGENT_SKILL_ROUTING_TOP_K);
  if (Number.isFinite(v) && v >= 1) {
    return Math.min(50, Math.floor(v));
  }
  return 8;
}

/** load_skill 是否仅允许当前轮的 routing shortlist（lexical/hybrid）；legacy 下不限制 */
export function skillLoadStrictFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.RAW_AGENT_SKILL_LOAD_STRICT ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const parts = lower.split(/[^a-z0-9\u4e00-\u9fff]+/).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (p.length >= 2) {
      out.push(p);
    }
    if (/[\u4e00-\u9fff]/.test(p) && p.length === 1) {
      out.push(p);
    }
  }
  return out;
}

function uniqueTokens(tokens: string[]): string[] {
  return [...new Set(tokens)];
}

/** 词法得分：每个 query token 只在 name / description / body 中计一次，取最高档权重 */
function lexicalScoreForSkill(skill: SkillSpec, queryTokens: string[]): { score: number; hits: string[] } {
  const name = (skill.name ?? '').toLowerCase();
  const desc = (skill.description ?? '').toLowerCase();
  const body = (skill.content ?? '').slice(0, BODY_SLICE).toLowerCase();

  let score = 0;
  const hits: string[] = [];

  for (const t of queryTokens) {
    if (!t) continue;
    if (name.includes(t)) {
      score += 14;
      hits.push(`name:${t}`);
    } else if (desc.includes(t)) {
      score += 6;
      hits.push(`desc:${t}`);
    } else if (body.includes(t)) {
      score += 2;
      hits.push(`body:${t}`);
    }
  }

  const fullQ = queryTokens.join(' ').trim();
  if (fullQ.length >= 4) {
    const blob = `${name} ${desc}`;
    if (blob.includes(fullQ)) {
      score += 22;
      hits.push('phrase:name+desc');
    } else if (body.includes(fullQ)) {
      score += 10;
      hits.push('phrase:body');
    }
  }

  return { score, hits };
}

export interface RoutedSkill {
  skill: SkillSpec;
  score: number;
  /** 简短命中说明，便于写进 system prompt */
  reason: string;
}

/**
 * 基于 name + description + 正文前几万字符做轻量词法排序，返回 top-K。
 */
export function routeSkillsLexical(query: string, skills: SkillSpec[], topK: number): RoutedSkill[] {
  const q = query.trim();
  if (!q) {
    return skills.slice(0, topK).map((skill) => ({ skill, score: 0, reason: '(empty query)' }));
  }

  const queryTokens = uniqueTokens(tokenize(q));
  if (queryTokens.length === 0) {
    const lowerQ = q.toLowerCase();
    return skills
      .map((skill) => {
        const blob = `${skill.name} ${skill.description} ${(skill.content ?? '').slice(0, BODY_SLICE)}`.toLowerCase();
        const hit = blob.includes(lowerQ);
        return {
          skill,
          score: hit ? 5 : 0,
          reason: hit ? 'substring' : 'no-token-match'
        };
      })
      .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
      .slice(0, topK);
  }

  const ranked = skills
    .map((skill) => {
      const { score, hits } = lexicalScoreForSkill(skill, queryTokens);
      const reason = hits.length ? hits.slice(0, 6).join(', ') : 'no-hit';
      return { skill, score, reason };
    })
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name));

  return ranked.slice(0, topK);
}

export interface SkillRoutingResult {
  mode: SkillRoutingMode;
  shortlistNames: string[];
  routed: RoutedSkill[];
  keywordMatched: SkillSpec[];
}

export function buildSkillRouting(
  userText: string,
  allSkills: SkillSpec[],
  options: { mode: SkillRoutingMode; topK: number }
): SkillRoutingResult {
  const { mode, topK } = options;

  if (mode === 'legacy') {
    const keywordMatched = matchSkills(userText, allSkills);
    return {
      mode,
      shortlistNames: allSkills.map((s) => s.name),
      routed: [],
      keywordMatched
    };
  }

  const keywordMatched = mode === 'hybrid' ? matchSkills(userText, allSkills) : [];
  const routed = routeSkillsLexical(userText, allSkills, topK);
  const nameSet = new Set<string>();
  for (const r of routed) {
    nameSet.add(r.skill.name);
  }
  for (const s of keywordMatched) {
    nameSet.add(s.name);
  }
  const shortlistNames = [...nameSet];

  return {
    mode,
    shortlistNames,
    routed,
    keywordMatched
  };
}
