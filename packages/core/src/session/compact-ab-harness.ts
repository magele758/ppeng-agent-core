/**
 * Live-model A/B harness for after-consume tool-result eviction.
 *
 * Seeds a consumed host-diagnostic dump + follow-up. Preview helpers are pure
 * (no LLM). The CI script (`scripts/compact-ab-eval.mjs`) asks a real model
 * for the last-deploy artifact path after the Lab compact policy runs.
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

/** Probe fact: last-deploy artifact path. Only appears in stdout, never in the command. */
export function makeSecretToken(): string {
  return `/var/lib/ppeng/releases/rel_${randomBytes(6).toString('hex')}/gateway.tgz`;
}

const GATEWAY_LOG_TEMPLATE = [
  '2026-09-02T07:48:01.011Z INFO  gateway listen :37070 pid=1842',
  '2026-09-02T07:48:01.204Z INFO  sqlite open /var/lib/ppeng/state/agent.db schema=10',
  '2026-09-02T07:48:02.440Z INFO  skills loaded repo=14 agents=6 merged=18',
  '2026-09-02T07:48:03.118Z DEBUG session.create id=ses_0k4m agent=general',
  '2026-09-02T07:48:11.002Z INFO  deploy.begin target=https://api.internal.example:8443/v1/ready',
  '2026-09-02T07:48:11.880Z DEBUG http POST /v1/ready attempt=1 timeout_ms=2500',
  '2026-09-02T07:48:14.381Z WARN  http POST /v1/ready attempt=1 err=ECONNREFUSED',
  '2026-09-02T07:48:15.102Z DEBUG http POST /v1/ready attempt=2 timeout_ms=2500',
  '2026-09-02T07:48:17.604Z WARN  http POST /v1/ready attempt=2 err=ECONNREFUSED',
  '2026-09-02T07:48:18.010Z ERROR deploy.fail reason=upstream_unreachable retries=2',
  '2026-09-02T07:48:18.441Z INFO  rollback keep previous release on disk',
  '2026-09-02T07:48:19.220Z INFO  /api/readiness ready=true deploy=degraded',
  '2026-09-02T07:48:40.003Z DEBUG compact.settings policy=keep_recent keepRecent=3',
  '2026-09-02T07:49:01.550Z INFO  cron tick evolution skipped (manual only)'
];

export function buildDiagnosticDump(artifactPath: string, minChars = 2400): string {
  const header = [
    '=== host ===',
    'hostname: lab-ci-worker-7',
    'uname: Linux 6.12.94+ x86_64',
    'uptime: 4 days, 3:12',
    'load: 0.42 0.38 0.31',
    '',
    '=== git ===',
    '## cursor/tool-result-evict-experiment-cf5a',
    ' M packages/core/src/session/micro-compact.ts',
    ' M packages/core/src/session/compact-ab-harness.ts',
    '',
    '=== last-deploy ===',
    'status: failed',
    'error: ECONNREFUSED',
    'target: https://api.internal.example:8443/v1/ready',
    `artifact: ${artifactPath}`,
    'started_at: 2026-09-02T07:48:11Z',
    'finished_at: 2026-09-02T07:48:19Z',
    'operator: ci-bot',
    '',
    '=== logs/gateway ===',
    ...GATEWAY_LOG_TEMPLATE,
    '',
    '=== dir /opt/app ===',
    'drwxr-xr-x  4 root root  4096 Sep  2 07:40 .',
    'drwxr-xr-x 12 root root  4096 Sep  1 11:02 ..',
    'drwxr-xr-x  2 root root  4096 Sep  2 07:48 bin',
    'drwxr-xr-x  3 root root  4096 Sep  2 07:49 logs',
    '-rw-r--r--  1 root root   812 Sep  2 07:40 gateway.config.json',
    '',
    '=== dir /opt/app/logs ===',
    '-rw-r--r--  1 root root 184201 Sep  2 07:49 gateway.current',
    '-rw-r--r--  1 root root  99120 Sep  1 23:59 gateway.1',
    ''
  ].join('\n');

  if (header.length >= minChars) {
    return `${header}=== end ===\n`;
  }

  const extra: string[] = [];
  let i = 0;
  while (header.length + extra.join('\n').length < minChars) {
    const sec = String(i % 60).padStart(2, '0');
    extra.push(
      `2026-09-02T07:50:${sec}.${String(i).padStart(3, '0')}Z DEBUG worker tick i=${i} bytes=4096 queue=0`
    );
    i += 1;
  }
  return `${header}${extra.join('\n')}\n=== end ===\n`;
}

/** @deprecated Use buildDiagnosticDump — kept for callers that still import this name. */
export function padToolDump(token: string, minChars = 2400): string {
  return buildDiagnosticDump(token, minChars);
}

export function firstUserPrompt(): string {
  return [
    'Please run the host diagnostic (uname, git status, last-deploy record, recent gateway logs)',
    'and briefly confirm you captured it.'
  ].join(' ');
}

export function followUpPrompt(): string {
  return [
    'In the last-deploy section of that diagnostic dump, what was the artifact path?',
    'Reply with only the filesystem path.',
    'Do not use tools.'
  ].join(' ');
}

export function consumedAssistantText(caseId: CompactAbCaseId, token: string): string {
  if (caseId === 'restated') {
    return `Diagnostic dump captured. Last deploy failed with ECONNREFUSED; artifact is ${token}.`;
  }
  return 'Diagnostic dump captured. Last deploy failed with ECONNREFUSED; host and git look ordinary.';
}

/** Command history must not mention the artifact path — otherwise silent eviction still leaks it. */
export function bashCommandForDump(): string {
  return [
    "bash -lc '",
    'echo "=== host ==="; uname -a; uptime;',
    'echo "=== git ==="; git status -sb;',
    'echo "=== last-deploy ==="; cat /var/lib/ppeng/last-deploy.txt;',
    'echo "=== logs/gateway ==="; tail -n 80 /opt/app/logs/gateway.current;',
    'echo "=== dir ==="; ls -la /opt/app /opt/app/logs',
    "'"
  ].join(' ');
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
    dump: buildDiagnosticDump(token, input?.minChars ?? 2400),
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
