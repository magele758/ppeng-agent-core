/**
 * Live-model A/B harness for after-consume tool-result eviction.
 *
 * Seeds a consumed bash dump + follow-up question. Preview helpers are pure
 * (no LLM). The CI script (`scripts/compact-ab-eval.mjs`) asks a real model
 * whether it can still read SECRET_TOKEN after the Lab compact policy runs.
 *
 * Policy is applied via `writeCompactSettings` (daemon_control KV), not a new
 * RAW_AGENT_* switch.
 */

import { randomBytes } from 'node:crypto';
import { estimateMessageTokens } from '../model/token-estimate.js';
import type { MessagePart, SessionMessage, TokenUsage } from '../types.js';
import {
  DEFAULT_MICRO_COMPACT_CONFIG,
  microCompactMessages,
  type MicroCompactConfig,
  type MicroCompactPolicy
} from './micro-compact.js';

export const COMPACT_AB_DEFAULT_POLICIES = ['keep_recent', 'after_text_assistant'] as const;
export const COMPACT_AB_DEFAULT_CASES = ['silent'] as const;

export type CompactAbPolicyId = MicroCompactPolicy;
export type CompactAbCaseId = 'silent' | 'restated';

export interface CompactAbSeed {
  token: string;
  caseId: CompactAbCaseId;
  toolCallId: string;
  firstUser: string;
  followUp: string;
  dump: string;
  consumedText: string;
  command: string;
}

export interface CompactAbSeedParts {
  assistantToolCall: MessagePart[];
  toolResult: MessagePart[];
  assistantConsumed: MessagePart[];
}

export interface CompactAbViewPreview {
  collapsed: number;
  charsSaved: number;
  tokens: number;
  baselineTokens: number;
  tokenInView: boolean;
}

export interface CompactAbRunRow {
  policy: CompactAbPolicyId;
  caseId: CompactAbCaseId;
  token: string;
  recalled: boolean;
  expectedTokenInView: boolean;
  collapsed: number;
  charsSaved: number;
  viewTokens: number;
  baselineTokens: number;
  usage?: Pick<TokenUsage, 'inputTokens' | 'outputTokens' | 'totalTokens' | 'requests'>;
  costUsd?: number;
  elapsedMs: number;
  answerPreview: string;
  sessionStatus?: string;
  error?: string;
}

export interface CompactAbSummary {
  completed: number;
  failed: number;
  recalled: number;
  /** Baseline recalled the silent token; after_text_assistant did not. */
  qualityRegression: boolean;
  inputTokensByPolicy: Record<string, number>;
}

export interface CompactAbReport {
  generatedAt: string;
  adapter?: string;
  model?: string;
  skipped?: boolean;
  skipReason?: string;
  runs: CompactAbRunRow[];
  summary: CompactAbSummary;
}

const ALLOWED_POLICIES = new Set<string>([
  'keep_recent',
  'after_any_assistant',
  'after_text_assistant'
]);

const ALLOWED_CASES = new Set<string>(['silent', 'restated']);

export function makeSecretToken(): string {
  return `AB_EVAL_${randomBytes(6).toString('hex').toUpperCase()}`;
}

export function padToolDump(token: string, minChars = 800): string {
  const line = `SECRET_TOKEN=${token}`;
  const filler = 'x'.repeat(Math.max(0, minChars - line.length - 32));
  return `BEGIN_DUMP\n${line}\n${filler}\nEND_DUMP`;
}

export function firstUserPrompt(): string {
  return 'Please run bash to print the diagnostic dump, then briefly confirm you ran it.';
}

export function followUpPrompt(): string {
  return [
    'What was SECRET_TOKEN in the previous bash output?',
    'Reply with only the token value (the AB_EVAL_... string).',
    'Do not use tools.'
  ].join(' ');
}

export function consumedAssistantText(caseId: CompactAbCaseId, token: string): string {
  if (caseId === 'restated') {
    return `Command finished. SECRET_TOKEN=${token}`;
  }
  return 'Command finished successfully. The dump is in the tool result.';
}

/** Command history must not mention the token — otherwise silent eviction still leaks it. */
export function bashCommandForDump(): string {
  return `python3 -c "print('BEGIN_DUMP'); print('x'*800); print('END_DUMP')"`;
}

export function buildCompactAbSeed(input?: {
  token?: string;
  caseId?: CompactAbCaseId;
  minChars?: number;
}): CompactAbSeed {
  const token = input?.token ?? makeSecretToken();
  const caseId = input?.caseId ?? 'silent';
  return {
    token,
    caseId,
    toolCallId: 'call_compact_ab_1',
    firstUser: firstUserPrompt(),
    followUp: followUpPrompt(),
    dump: padToolDump(token, input?.minChars ?? 800),
    consumedText: consumedAssistantText(caseId, token),
    command: bashCommandForDump()
  };
}

export function seedParts(seed: CompactAbSeed): CompactAbSeedParts {
  return {
    assistantToolCall: [
      {
        type: 'tool_call',
        toolCallId: seed.toolCallId,
        name: 'bash',
        input: { command: seed.command }
      }
    ],
    toolResult: [
      {
        type: 'tool_result',
        toolCallId: seed.toolCallId,
        name: 'bash',
        ok: true,
        content: seed.dump
      }
    ],
    assistantConsumed: [{ type: 'text', text: seed.consumedText }]
  };
}

export function seedMessages(seed: CompactAbSeed): SessionMessage[] {
  const parts = seedParts(seed);
  const ts = '2026-09-02T00:00:00.000Z';
  const sid = 'compact-ab';
  return [
    { id: 'u1', sessionId: sid, role: 'user', parts: [{ type: 'text', text: seed.firstUser }], createdAt: ts },
    { id: 'a1', sessionId: sid, role: 'assistant', parts: parts.assistantToolCall, createdAt: ts },
    { id: 't1', sessionId: sid, role: 'tool', parts: parts.toolResult, createdAt: ts },
    { id: 'a2', sessionId: sid, role: 'assistant', parts: parts.assistantConsumed, createdAt: ts },
    { id: 'u2', sessionId: sid, role: 'user', parts: [{ type: 'text', text: seed.followUp }], createdAt: ts }
  ];
}

export function compactAbPolicyConfig(policy: CompactAbPolicyId): MicroCompactConfig {
  return {
    ...DEFAULT_MICRO_COMPACT_CONFIG,
    enabled: true,
    keepRecent: policy === 'keep_recent' ? 3 : 0,
    minChars: 100,
    policy
  };
}

function viewText(messages: SessionMessage[]): string {
  const chunks: string[] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === 'text') chunks.push(part.text);
      if (part.type === 'tool_result') chunks.push(part.content);
    }
  }
  return chunks.join('\n');
}

export function previewCompactAbView(
  policy: CompactAbPolicyId,
  seed: CompactAbSeed
): CompactAbViewPreview {
  const messages = seedMessages(seed);
  const compact = microCompactMessages(messages, compactAbPolicyConfig(policy));
  return {
    collapsed: compact.stats.collapsed,
    charsSaved: compact.stats.charsSaved,
    tokens: estimateMessageTokens(compact.messages),
    baselineTokens: estimateMessageTokens(messages),
    tokenInView: viewText(compact.messages).includes(seed.token)
  };
}

export function answerRecallsToken(answer: string, token: string): boolean {
  const needle = token.trim();
  if (!needle) return false;
  return answer.includes(needle) || answer.toUpperCase().includes(needle.toUpperCase());
}

export function redactAnswerPreview(answer: string, max = 240): string {
  return String(answer ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function parsePolicyList(raw: string | undefined): CompactAbPolicyId[] {
  const items = (raw ?? COMPACT_AB_DEFAULT_POLICIES.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is CompactAbPolicyId => ALLOWED_POLICIES.has(s));
  return items.length > 0 ? unique(items) : [...COMPACT_AB_DEFAULT_POLICIES];
}

export function parseCaseList(raw: string | undefined): CompactAbCaseId[] {
  const items = (raw ?? COMPACT_AB_DEFAULT_CASES.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is CompactAbCaseId => ALLOWED_CASES.has(s));
  return items.length > 0 ? unique(items) : [...COMPACT_AB_DEFAULT_CASES];
}

export function summarizeCompactAbRuns(runs: CompactAbRunRow[]): CompactAbSummary {
  const completed = runs.filter((row) => !row.error);
  const keepSilent = completed.find((row) => row.policy === 'keep_recent' && row.caseId === 'silent');
  const afterSilent = completed.find(
    (row) => row.policy === 'after_text_assistant' && row.caseId === 'silent'
  );
  const inputTokensByPolicy: Record<string, number> = {};
  for (const row of completed) {
    inputTokensByPolicy[row.policy] =
      (inputTokensByPolicy[row.policy] ?? 0) + (row.usage?.inputTokens ?? 0);
  }
  return {
    completed: completed.length,
    failed: runs.length - completed.length,
    recalled: completed.filter((row) => row.recalled).length,
    qualityRegression: Boolean(keepSilent?.recalled && afterSilent && !afterSilent.recalled),
    inputTokensByPolicy
  };
}

export function formatCompactAbReport(report: CompactAbReport): string {
  if (report.skipped) {
    return `compact-ab: skipped (${report.skipReason ?? 'n/a'})`;
  }
  const lines = [
    `compact-ab ${report.generatedAt}`,
    `adapter=${report.adapter ?? '?'} model=${report.model ?? '?'}`,
    `completed=${report.summary.completed} failed=${report.summary.failed} recalled=${report.summary.recalled} quality_regression=${report.summary.qualityRegression}`
  ];
  for (const row of report.runs) {
    const usage = row.usage
      ? ` in=${row.usage.inputTokens} out=${row.usage.outputTokens} tot=${row.usage.totalTokens}`
      : '';
    const err = row.error ? ` error=${row.error}` : '';
    lines.push(
      `  ${row.policy}/${row.caseId}: recalled=${row.recalled} in_view=${row.expectedTokenInView} collapsed=${row.collapsed} chars_saved=${row.charsSaved} view_tok=${row.viewTokens} base_tok=${row.baselineTokens}${usage} ${row.elapsedMs}ms${err}`
    );
    if (row.answerPreview) lines.push(`    answer: ${row.answerPreview}`);
  }
  return lines.join('\n');
}
