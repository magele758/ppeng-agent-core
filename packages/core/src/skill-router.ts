/**
 * SkillRouter 轻量落地：词法 shortlist（name + description + body 前 24k），无训练。
 * 改造前/后对照与 env 说明见仓库 `docs/skill-router-baseline.md`。
 */
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

export type RoutingConfidence = 'high' | 'medium' | 'low';

export interface RoutingConfidenceInfo {
  level: RoutingConfidence;
  /** Score gap between top-1 and top-2 (0 if only one candidate) */
  scoreGap: number;
  /** Number of skills within 30% of top score */
  nearTopCount: number;
  /** Reason for confidence level */
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
  /** Confidence assessment for routing quality */
  confidence: RoutingConfidenceInfo;
}

/**
 * Assess confidence in routing result based on score distribution.
 * High confidence: clear winner with significant score gap
 * Medium confidence: top skill stands out but has close competitors
 * Low confidence: multiple skills with similar scores (ambiguous intent)
 */
function assessRoutingConfidence(routed: RoutedSkill[]): RoutingConfidenceInfo {
  if (routed.length === 0) {
    return {
      level: 'low',
      scoreGap: 0,
      nearTopCount: 0,
      reason: 'no matching skills found'
    };
  }

  if (routed.length === 1) {
    const top = routed[0]!;
    return {
      level: top.score >= 10 ? 'high' : 'medium',
      scoreGap: top.score,
      nearTopCount: 1,
      reason: top.score >= 10
        ? 'single strong match'
        : 'single weak match'
    };
  }

  const topScore = routed[0]!.score;
  const secondScore = routed[1]!.score;
  const scoreGap = topScore - secondScore;

  // Count skills within 30% of top score (meaningful competitors)
  const threshold = Math.max(topScore * 0.7, topScore - 5);
  const nearTopCount = routed.filter((r) => r.score >= threshold).length;

  // High confidence: significant gap (>8 points) and top score is meaningful
  if (scoreGap >= 8 && topScore >= 14) {
    return {
      level: 'high',
      scoreGap,
      nearTopCount,
      reason: `clear winner: ${routed[0]!.skill.name} leads by ${scoreGap} points`
    };
  }

  // Low confidence: multiple skills with very similar scores
  if (scoreGap <= 3 && nearTopCount >= 2) {
    return {
      level: 'low',
      scoreGap,
      nearTopCount,
      reason: `ambiguous: ${nearTopCount} skills within reach of top score`
    };
  }

  // Medium confidence: top skill is distinguishable but not dominant
  return {
    level: 'medium',
    scoreGap,
    nearTopCount,
    reason: nearTopCount > 1
      ? `moderate clarity: ${nearTopCount} competitive candidates`
      : 'reasonable match with no strong competitors'
  };
}

export function buildSkillRouting(
  userText: string,
  allSkills: SkillSpec[],
  options: { mode: SkillRoutingMode; topK: number }
): SkillRoutingResult {
  const { mode, topK } = options;

  if (mode === 'legacy') {
    const keywordMatched = matchSkills(userText, allSkills);
    const legacyConfidence: RoutingConfidenceInfo = keywordMatched.length > 0
      ? {
          level: 'high',
          scoreGap: 0,
          nearTopCount: keywordMatched.length,
          reason: `legacy keyword match: ${keywordMatched.length} skill(s) triggered`
        }
      : {
          level: 'low',
          scoreGap: 0,
          nearTopCount: 0,
          reason: 'legacy mode: no keyword matches'
        };
    return {
      mode,
      shortlistNames: allSkills.map((s) => s.name),
      routed: [],
      keywordMatched,
      confidence: legacyConfidence
    };
  }

  const keywordMatched = mode === 'hybrid' ? matchSkills(userText, allSkills) : [];
  const routed = routeSkillsLexical(userText, allSkills, topK);
  const confidence = assessRoutingConfidence(routed);
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
    keywordMatched,
    confidence
  };
}
