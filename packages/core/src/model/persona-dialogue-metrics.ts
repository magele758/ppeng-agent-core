/**
 * Dialogue analytics for persona-driven, goal-oriented multi-turn chats.
 *
 * Mirrors lightweight signals highlighted in SalesSim (arXiv:2605.08334): lexical
 * diversity in simulated user turns and a coarse checklist of whether substantive
 * terms from a persona spec appear in those turns (alignment / recall proxy for
 * harnesses — not a full LLM-as-judge).
 */

import type { MessageRole, SessionMessage } from '../types.js';

const STOPWORDS = new Set([
  'a',
  'about',
  'all',
  'also',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'been',
  'being',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'each',
  'even',
  'for',
  'from',
  'had',
  'has',
  'have',
  'here',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'just',
  'less',
  'may',
  'me',
  'might',
  'more',
  'most',
  'much',
  'must',
  'my',
  'no',
  'not',
  'of',
  'on',
  'only',
  'or',
  'our',
  'shall',
  'should',
  'so',
  'some',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'to',
  'too',
  'very',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
  'yes'
]);

export interface LexicalDiversitySummary {
  /** Unique tokens / total tokens; 1 when there are zero tokens */
  typeTokenRatio: number;
  uniqueTokens: number;
  totalTokens: number;
}

export interface PersonaDialogueMetrics {
  lexicalUser: LexicalDiversitySummary;
  lexicalAssistant: LexicalDiversitySummary;
  /**
   * When `personaSpecText` was provided with at least one non-stopword term:
   * fraction of those terms that appear ≥1× in aggregated user-role text (case-insensitive).
   */
  personaTermRecall?: number;
  /** Distinct substantive terms extracted from the persona spec */
  personaTermsConsidered?: number;
}

/**
 * Normalize free text → filtered lowercase tokens suitable for lexical / recall stats.
 */
export function extractDialogueTokens(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/-/g, '')
    .replace(/[^a-z0-9]+/g, ' ');
  const raw = cleaned.split(/\s+/).filter(Boolean);
  return raw.filter(t => t.length >= 2 && !STOPWORDS.has(t));
}

export function computeLexicalDiversity(tokens: string[]): LexicalDiversitySummary {
  if (tokens.length === 0) {
    return { typeTokenRatio: 1, uniqueTokens: 0, totalTokens: 0 };
  }
  const unique = new Set(tokens);
  return {
    typeTokenRatio: unique.size / tokens.length,
    uniqueTokens: unique.size,
    totalTokens: tokens.length
  };
}

function concatTextParts(messages: SessionMessage[], role: MessageRole): string {
  const chunks: string[] = [];
  for (const msg of messages) {
    if (msg.role !== role) continue;
    for (const part of msg.parts) {
      if (part.type === 'text' && part.text) {
        chunks.push(part.text);
      }
    }
  }
  return chunks.join(' ');
}

/**
 * Distinct substantive terms from a persona / preference blurb (e.g. dealbreakers, budget cues).
 */
export function personaSpecTerms(personaSpecText: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of extractDialogueTokens(personaSpecText)) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Share of persona terms observed in simulated user utterances (by text match).
 */
export function computePersonaTermRecall(personaTerms: string[], userDialogueText: string): number {
  if (personaTerms.length === 0) return 1;
  const userTokens = new Set(extractDialogueTokens(userDialogueText));
  let hit = 0;
  for (const term of personaTerms) {
    if (userTokens.has(term)) hit++;
  }
  return hit / personaTerms.length;
}

export interface PersonaDialogueMetricsOptions {
  /** Persona/preferences copy used to derive recall targets (omit to skip recall) */
  personaSpecText?: string;
}

/**
 * Aggregates lexical stats for user vs assistant text parts and optional persona recall.
 */
export function computePersonaDialogueMetrics(
  messages: SessionMessage[],
  options?: PersonaDialogueMetricsOptions
): PersonaDialogueMetrics {
  const userText = concatTextParts(messages, 'user');
  const assistantText = concatTextParts(messages, 'assistant');
  const userTokens = extractDialogueTokens(userText);
  const assistantTokens = extractDialogueTokens(assistantText);

  const lexicalUser = computeLexicalDiversity(userTokens);
  const lexicalAssistant = computeLexicalDiversity(assistantTokens);

  const spec = options?.personaSpecText?.trim();
  const terms = spec ? personaSpecTerms(spec) : [];

  if (terms.length === 0) {
    return { lexicalUser, lexicalAssistant };
  }

  return {
    lexicalUser,
    lexicalAssistant,
    personaTermRecall: computePersonaTermRecall(terms, userText),
    personaTermsConsidered: terms.length
  };
}
