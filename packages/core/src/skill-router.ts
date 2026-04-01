/**
 * SkillRouter 轻量落地：词法 shortlist（name + description + body 前 24k），无训练。
 * 改造前/后对照与 env 说明见仓库 `docs/skill-router-baseline.md`。
 *
 * ## FusionRAG-inspired Context Enhancement
 * Inspired by "From Prefix Cache to Fusion RAG Cache" (arXiv:2601.12904), this router
 * precomputes skill relationships and fuses context from related skills during routing.
 * This improves matching quality when a query matches one skill but the user's intent
 * is better served by a related skill with different trigger words.
 */
import type { SkillSpec } from './types.js';
import { matchSkills } from './builtin-skills.js';

export type SkillRoutingMode = 'legacy' | 'lexical' | 'hybrid';

const BODY_SLICE = 24_000;

/** Minimum similarity threshold for skills to be considered related. */
const MIN_RELATIONSHIP_SCORE = 0.15;

/** Maximum number of related skills to track per skill. */
const MAX_RELATED_SKILLS = 5;

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

/** Whether to use FusionRAG-style context fusion for skill routing. Default: false. */
export function skillRoutingFusionFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.RAW_AGENT_SKILL_ROUTING_FUSION ?? '').trim().toLowerCase();
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

/**
 * Represents a precomputed relationship between two skills.
 * Inspired by FusionRAG's cross-chunk context embedding.
 */
export interface SkillRelationship {
  /** Name of the related skill. */
  skillName: string;
  /** Similarity score (0-1) based on token overlap. */
  similarity: number;
  /** Shared tokens that indicate the relationship. */
  sharedTokens: string[];
}

/**
 * Precomputed skill relationships for context fusion.
 * This is the "offline preprocessing" phase inspired by FusionRAG.
 */
export interface SkillRelationshipCache {
  /** Map from skill name to its related skills. */
  relationships: Map<string, SkillRelationship[]>;
  /** Timestamp when the cache was built (for invalidation). */
  builtAt: number;
  /** Hash of skill names for cache validation. */
  skillHash: string;
}

/**
 * Compute Jaccard-like similarity between two token sets.
 * Returns a score between 0 and 1.
 */
function computeTokenSimilarity(tokensA: Set<string>, tokensB: Set<string>): number {
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Extract tokens from a skill for relationship computation.
 * Uses name, description, trigger words, and body prefix.
 */
function extractSkillTokens(skill: SkillSpec): Set<string> {
  const tokens = new Set<string>();

  // Add name and description tokens
  const nameTokens = tokenize(skill.name ?? '');
  const descTokens = tokenize(skill.description ?? '');
  const bodyTokens = tokenize((skill.content ?? '').slice(0, BODY_SLICE));

  for (const t of nameTokens) tokens.add(t);
  for (const t of descTokens) tokens.add(t);
  for (const t of bodyTokens) tokens.add(t);

  // Add trigger words (already normalized)
  if (skill.triggerWords) {
    for (const tw of skill.triggerWords) {
      const normalized = tw.toLowerCase().trim();
      if (normalized.length >= 2) tokens.add(normalized);
    }
  }

  return tokens;
}

/**
 * Build a relationship cache for all skills.
 * This is the "offline preprocessing" phase that embeds cross-skill context.
 */
export function buildSkillRelationshipCache(skills: SkillSpec[]): SkillRelationshipCache {
  const relationships = new Map<string, SkillRelationship[]>();
  const skillTokens = new Map<string, Set<string>>();
  const skillNames: string[] = [];

  // Extract tokens for each skill
  for (const skill of skills) {
    const tokens = extractSkillTokens(skill);
    skillTokens.set(skill.name, tokens);
    skillNames.push(skill.name);
  }

  // Compute pairwise relationships
  for (const skillA of skills) {
    const tokensA = skillTokens.get(skillA.name)!;
    const related: SkillRelationship[] = [];

    for (const skillB of skills) {
      if (skillA.name === skillB.name) continue;

      const tokensB = skillTokens.get(skillB.name)!;
      const similarity = computeTokenSimilarity(tokensA, tokensB);

      if (similarity >= MIN_RELATIONSHIP_SCORE) {
        // Find shared tokens
        const sharedTokens: string[] = [];
        for (const t of tokensA) {
          if (tokensB.has(t)) sharedTokens.push(t);
        }

        related.push({
          skillName: skillB.name,
          similarity,
          sharedTokens: sharedTokens.slice(0, 10)
        });
      }
    }

    // Sort by similarity and keep top N
    related.sort((a, b) => b.similarity - a.similarity);
    relationships.set(skillA.name, related.slice(0, MAX_RELATED_SKILLS));
  }

  // Create hash for cache validation
  const skillHash = skillNames.sort().join(',');

  return {
    relationships,
    builtAt: Date.now(),
    skillHash
  };
}

/** Check if a relationship cache needs rebuilding. */
export function needsRebuild(cache: SkillRelationshipCache | null, currentSkills: SkillSpec[]): boolean {
  if (!cache) return true;
  const currentHash = currentSkills.map(s => s.name).sort().join(',');
  return cache.skillHash !== currentHash;
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
  /** Optional: relationship cache used for fusion (when fusion mode is active) */
  relationshipCache?: SkillRelationshipCache;
}

/** Extended options for skill routing with fusion support. */
export interface SkillRoutingOptions {
  mode: SkillRoutingMode;
  topK: number;
  /** Enable FusionRAG-style context fusion. Default: false for backward compatibility. */
  useFusion?: boolean;
  /** Pre-existing relationship cache (will be rebuilt if stale). */
  relationshipCache?: SkillRelationshipCache | null;
}

/**
 * Build skill routing with optional FusionRAG-style context fusion.
 * When fusion is enabled, related skills receive a context boost based on
 * precomputed relationships, addressing the cross-context matching problem.
 */
export function buildSkillRoutingWithFusion(
  userText: string,
  allSkills: SkillSpec[],
  options: SkillRoutingOptions
): SkillRoutingResult {
  const { mode, topK, useFusion = false, relationshipCache = null } = options;

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

  // Use fusion routing if enabled
  let cache = relationshipCache;
  let routed: RoutedSkill[];

  if (useFusion) {
    // Rebuild cache if needed
    if (needsRebuild(cache, allSkills)) {
      cache = buildSkillRelationshipCache(allSkills);
    }
    routed = routeSkillsWithFusion(userText, allSkills, cache!, topK);
  } else {
    routed = routeSkillsLexical(userText, allSkills, topK);
  }

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
    confidence,
    relationshipCache: useFusion ? cache! : undefined
  };
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

/**
 * Route skills with FusionRAG-inspired context fusion.
 * When a skill matches, related skills get a context boost based on:
 * 1. Their relationship similarity
 * 2. Shared tokens with the query
 *
 * This addresses the "cross-chunk context" problem from the FusionRAG paper:
 * queries may match one skill's keywords but the user's intent is better
 * served by a related skill with different terminology.
 */
export function routeSkillsWithFusion(
  query: string,
  skills: SkillSpec[],
  cache: SkillRelationshipCache,
  topK: number
): RoutedSkill[] {
  const q = query.trim();
  if (!q) {
    return skills.slice(0, topK).map((skill) => ({ skill, score: 0, reason: '(empty query)' }));
  }

  const queryTokens = uniqueTokens(tokenize(q));
  const queryTokenSet = new Set(queryTokens);
  const skillByName = new Map(skills.map(s => [s.name, s]));

  // First pass: compute base lexical scores
  const baseScores = new Map<string, { score: number; hits: string[] }>();
  for (const skill of skills) {
    const result = lexicalScoreForSkill(skill, queryTokens);
    baseScores.set(skill.name, result);
  }

  // Second pass: apply fusion boost from related skills
  const fusionBoosts = new Map<string, { boost: number; sources: string[] }>();

  for (const skill of skills) {
    const baseResult = baseScores.get(skill.name)!;
    if (baseResult.score < 2) continue; // Only boost from skills with meaningful matches

    const related = cache.relationships.get(skill.name) ?? [];
    for (const rel of related) {
      // Check if shared tokens match query tokens
      const matchingSharedTokens = rel.sharedTokens.filter(t => queryTokenSet.has(t));
      if (matchingSharedTokens.length === 0) continue;

      // Compute boost proportional to similarity and matching tokens
      const boost = Math.round(baseResult.score * rel.similarity * 0.3 * (matchingSharedTokens.length / Math.max(1, rel.sharedTokens.length)));

      if (boost > 0) {
        const existing = fusionBoosts.get(rel.skillName) ?? { boost: 0, sources: [] };
        existing.boost += boost;
        existing.sources.push(`${skill.name}(+${boost})`);
        fusionBoosts.set(rel.skillName, existing);
      }
    }
  }

  // Combine base scores with fusion boosts
  const results: RoutedSkill[] = skills.map((skill) => {
    const base = baseScores.get(skill.name)!;
    const fusion = fusionBoosts.get(skill.name);

    const finalScore = base.score + (fusion?.boost ?? 0);
    let reason = base.hits.length ? base.hits.slice(0, 4).join(', ') : 'no-hit';

    if (fusion && fusion.boost > 0) {
      reason += `; fusion:+${fusion.boost} from ${fusion.sources.slice(0, 2).join(', ')}`;
    }

    return { skill, score: finalScore, reason };
  });

  results.sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name));
  return results.slice(0, topK);
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
