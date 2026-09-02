/**
 * Offline A/B for "evict tool results after the model has consumed them".
 *
 * Quality proxy is fact retention in the compacted *view* (not a live LLM).
 * A fact that only lived in a stubbed tool_result is treated as lost — the
 * same failure mode a later turn hits when it needs a path, error, or listing
 * the assistant never restated.
 */

import { estimateMessageTokens } from '../model/token-estimate.js';
import type { MessagePart, SessionMessage } from '../types.js';
import {
  DEFAULT_MICRO_COMPACT_CONFIG,
  microCompactMessages,
  type MicroCompactConfig,
  type MicroCompactPolicy
} from './micro-compact.js';

export type ExperimentPolicyId =
  | 'none'
  | 'keep_recent_3'
  | 'keep_recent_0'
  | 'after_any_assistant'
  | 'after_text_assistant';

export interface ExperimentSnapshot {
  id: string;
  /** What this moment represents in the loop. */
  when: string;
  messages: SessionMessage[];
  /** Strings that must still be visible for the next model turn to succeed. */
  neededFacts: string[];
}

export interface ExperimentCase {
  id: string;
  title: string;
  hypothesis: string;
  snapshots: ExperimentSnapshot[];
}

export interface PolicyScore {
  policy: ExperimentPolicyId;
  tokens: number;
  tokensSaved: number;
  tokenSavePct: number;
  charsSaved: number;
  collapsed: number;
  factsKept: number;
  factsTotal: number;
  missingFacts: string[];
}

export interface SnapshotReport {
  id: string;
  when: string;
  baselineTokens: number;
  scores: PolicyScore[];
}

export interface CaseReport {
  id: string;
  title: string;
  hypothesis: string;
  snapshots: SnapshotReport[];
}

export interface ExperimentReport {
  generatedAt: string;
  policies: ExperimentPolicyId[];
  cases: CaseReport[];
  verdicts: string[];
}

const COMPACT_BASE: Omit<MicroCompactConfig, 'policy' | 'keepRecent' | 'enabled'> = {
  minChars: 10,
  hardMaxChars: 12_000
};

const POLICY_CONFIG: Record<ExperimentPolicyId, MicroCompactConfig> = {
  none: { ...DEFAULT_MICRO_COMPACT_CONFIG, ...COMPACT_BASE, enabled: false, keepRecent: 3 },
  keep_recent_3: {
    ...DEFAULT_MICRO_COMPACT_CONFIG,
    ...COMPACT_BASE,
    enabled: true,
    keepRecent: 3,
    policy: 'keep_recent'
  },
  keep_recent_0: {
    ...DEFAULT_MICRO_COMPACT_CONFIG,
    ...COMPACT_BASE,
    enabled: true,
    keepRecent: 0,
    policy: 'keep_recent'
  },
  after_any_assistant: {
    ...DEFAULT_MICRO_COMPACT_CONFIG,
    ...COMPACT_BASE,
    enabled: true,
    keepRecent: 0,
    policy: 'after_any_assistant'
  },
  after_text_assistant: {
    ...DEFAULT_MICRO_COMPACT_CONFIG,
    ...COMPACT_BASE,
    enabled: true,
    keepRecent: 0,
    policy: 'after_text_assistant'
  }
};

export const EXPERIMENT_POLICIES: ExperimentPolicyId[] = [
  'none',
  'keep_recent_3',
  'keep_recent_0',
  'after_any_assistant',
  'after_text_assistant'
];

const TS = '2026-09-02T00:00:00.000Z';

function msg(
  id: string,
  role: SessionMessage['role'],
  parts: MessagePart[]
): SessionMessage {
  return { id, sessionId: 'exp', role, parts, createdAt: TS };
}

function user(id: string, text: string): SessionMessage {
  return msg(id, 'user', [{ type: 'text', text }]);
}

function assistantText(id: string, text: string): SessionMessage {
  return msg(id, 'assistant', [{ type: 'text', text }]);
}

function assistantToolCall(
  id: string,
  toolCallId: string,
  name: string,
  input: Record<string, unknown>
): SessionMessage {
  return msg(id, 'assistant', [{ type: 'tool_call', toolCallId, name, input }]);
}

function toolResult(
  id: string,
  toolCallId: string,
  name: string,
  content: string,
  ok = true
): SessionMessage {
  return msg(id, 'tool', [{ type: 'tool_result', toolCallId, name, ok, content }]);
}

function padFact(fact: string, size: number): string {
  const filler = 'x'.repeat(Math.max(0, size - fact.length - 16));
  return `BEGIN\n${fact}\n${filler}\nEND`;
}

function viewText(messages: SessionMessage[]): string {
  const chunks: string[] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === 'text') chunks.push(part.text);
      if (part.type === 'tool_result') chunks.push(part.content);
      if (part.type === 'tool_call') chunks.push(JSON.stringify(part.input));
    }
  }
  return chunks.join('\n');
}

function missingFacts(messages: SessionMessage[], facts: string[]): string[] {
  const blob = viewText(messages);
  return facts.filter((fact) => !blob.includes(fact));
}

export function scorePolicy(
  policy: ExperimentPolicyId,
  snapshot: ExperimentSnapshot
): PolicyScore {
  const baseline = estimateMessageTokens(snapshot.messages);
  const compact = microCompactMessages(snapshot.messages, POLICY_CONFIG[policy]);
  const tokens = estimateMessageTokens(compact.messages);
  const missing = missingFacts(compact.messages, snapshot.neededFacts);
  const tokensSaved = Math.max(0, baseline - tokens);
  return {
    policy,
    tokens,
    tokensSaved,
    tokenSavePct: baseline === 0 ? 0 : Math.round((tokensSaved / baseline) * 1000) / 10,
    charsSaved: compact.stats.charsSaved,
    collapsed: compact.stats.collapsed,
    factsKept: snapshot.neededFacts.length - missing.length,
    factsTotal: snapshot.neededFacts.length,
    missingFacts: missing
  };
}

const LISTING_FACT = 'secret-ledger-7f3a.json';
const OTHER_FILE_FACT = 'notes-old-backup.md';
const FILE_BODY_FACT = 'LEDGER_HASH=9c2e1b';
const ERROR_FACT = 'E_UNIQUE_CONSTRAINT_8841';
const RESTATED_FACT = 'deploy-window-2026-09-18';

export function buildExperimentCases(): ExperimentCase[] {
  const listing = padFact(
    `files:\n- ${OTHER_FILE_FACT}\n- ${LISTING_FACT}\n- README.md`,
    2400
  );
  const fileBody = padFact(`contents of ${LISTING_FACT}\n${FILE_BODY_FACT}`, 1800);
  const testLog = padFact(`FAIL tests/db.spec.ts ${ERROR_FACT}`, 3000);
  const dump = (token: string) => padFact(`RAW_DUMP ${token}`, 4000);

  const restatedDump = padFact(`calendar says ${RESTATED_FACT}`, 2200);

  const manyTurns: SessionMessage[] = [user('u-many', 'inspect each dump')];
  const dumpOnlyFacts: string[] = [];
  const restatedFacts: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const dumpTok = `DUMPONLY_${String(i).padStart(2, '0')}_ZZ`;
    const saidTok = `SAID_${String(i).padStart(2, '0')}_OK`;
    dumpOnlyFacts.push(dumpTok);
    restatedFacts.push(saidTok);
    manyTurns.push(
      assistantToolCall(`a-d${i}`, `c-d${i}`, 'bash', { command: `dump ${i}` }),
      toolResult(`t-d${i}`, `c-d${i}`, 'bash', dump(dumpTok)),
      assistantText(`a-s${i}`, `Summary ${i}: ${saidTok}`)
    );
  }

  return [
    {
      id: 'restated_digest',
      title: '助手已把关键事实写进正文',
      hypothesis: '消费后抽离应省 token，且 restated 事实仍在。',
      snapshots: [
        {
          id: 'consume_turn',
          when: '工具结果刚回、模型尚未开口（本轮必须看见全文）',
          messages: [
            user('u1', 'When is the deploy window?'),
            assistantToolCall('a1', 'c1', 'bash', { command: 'cat calendar.txt' }),
            toolResult('t1', 'c1', 'bash', restatedDump)
          ],
          neededFacts: [RESTATED_FACT]
        },
        {
          id: 'followup_turn',
          when: '助手已复述事实，用户追问',
          messages: [
            user('u1', 'When is the deploy window?'),
            assistantToolCall('a1', 'c1', 'bash', { command: 'cat calendar.txt' }),
            toolResult('t1', 'c1', 'bash', restatedDump),
            assistantText('a2', `The window is ${RESTATED_FACT}.`),
            user('u2', 'Repeat the window.')
          ],
          neededFacts: [RESTATED_FACT]
        }
      ]
    },
    {
      id: 'silent_digest',
      title: '助手只说「看到了」，未复述路径',
      hypothesis: '消费后抽离会丢掉只存在于 tool_result 的事实。',
      snapshots: [
        {
          id: 'consume_turn',
          when: '即将基于 ls 结果决策（必须保留 listing）',
          messages: [
            user('u1', 'Find the ledger file'),
            assistantToolCall('a1', 'c1', 'bash', { command: 'ls' }),
            toolResult('t1', 'c1', 'bash', listing)
          ],
          neededFacts: [LISTING_FACT, OTHER_FILE_FACT]
        },
        {
          id: 'followup_turn',
          when: '助手未复述路径，用户问文件名',
          messages: [
            user('u1', 'Find the ledger file'),
            assistantToolCall('a1', 'c1', 'bash', { command: 'ls' }),
            toolResult('t1', 'c1', 'bash', listing),
            assistantText('a2', 'Got the listing, I will use it next.'),
            user('u2', 'What was the ledger filename?')
          ],
          neededFacts: [LISTING_FACT]
        }
      ]
    },
    {
      id: 'tool_streak',
      title: '连续工具波：ls → 无正文 → read_file',
      hypothesis:
        'after_any 在第二次 tool_call 之后就会抽离 ls；after_text 要等出现正文才抽离。',
      snapshots: [
        {
          id: 'before_read',
          when: '刚拿到 ls，即将发出 read_file',
          messages: [
            user('u1', 'Read the ledger'),
            assistantToolCall('a1', 'c1', 'bash', { command: 'ls' }),
            toolResult('t1', 'c1', 'bash', listing)
          ],
          neededFacts: [LISTING_FACT, OTHER_FILE_FACT]
        },
        {
          id: 'after_read_call',
          when: '已发出 read_file（无正文），即将读文件结果并作答',
          messages: [
            user('u1', 'Read the ledger'),
            assistantToolCall('a1', 'c1', 'bash', { command: 'ls' }),
            toolResult('t1', 'c1', 'bash', listing),
            assistantToolCall('a2', 'c2', 'read_file', { path: LISTING_FACT }),
            toolResult('t2', 'c2', 'read_file', fileBody)
          ],
          neededFacts: [OTHER_FILE_FACT, FILE_BODY_FACT]
        }
      ]
    },
    {
      id: 'debug_retry',
      title: '失败栈只在早期 tool_result 里',
      hypothesis: '后续又跑了多次工具后，即时抽离会丢掉原始错误码。',
      snapshots: [
        {
          id: 'after_retries',
          when: '已重试两次，用户问最初错误',
          messages: [
            user('u1', 'Run tests and fix'),
            assistantToolCall('a1', 'c1', 'bash', { command: 'npm test' }),
            toolResult('t1', 'c1', 'bash', testLog, false),
            assistantText('a2', 'Tests failed, retrying with a patch.'),
            assistantToolCall('a3', 'c3', 'edit_file', { path: 'db.ts' }),
            toolResult('t3', 'c3', 'edit_file', padFact('patched connection pool', 800)),
            assistantToolCall('a4', 'c4', 'bash', { command: 'npm test' }),
            toolResult('t4', 'c4', 'bash', padFact('FAIL still flaky timeout', 800), false),
            assistantToolCall('a5', 'c5', 'bash', { command: 'npm test -- --grep smoke' }),
            toolResult('t5', 'c5', 'bash', padFact('smoke pass', 600)),
            user('u2', 'What was the original error code?')
          ],
          neededFacts: [ERROR_FACT]
        }
      ]
    },
    {
      id: 'many_dumps',
      title: '十轮大输出，每轮助手只留一行摘要',
      hypothesis: '即时抽离比 keep_recent=3 更省；dump-only 事实会丢，摘要事实还在。',
      snapshots: [
        {
          id: 'after_ten',
          when: '十轮工具+摘要之后的下一问',
          messages: [...manyTurns, user('u-end', 'Recap every dump token you saw.')],
          neededFacts: [...restatedFacts, ...dumpOnlyFacts]
        }
      ]
    },
    {
      id: 'unconsumed_wave',
      title: '最后一波工具结果尚未被模型消费',
      hypothesis: 'after_* 不得在模型开口前抽离；keep_recent=0 会误伤本轮。',
      snapshots: [
        {
          id: 'pending',
          when: '两份大结果刚回，下一轮还没开始吐',
          messages: [
            user('u1', 'Compare both files'),
            assistantToolCall('a1', 'c1', 'read_file', { path: 'a.txt' }),
            assistantToolCall('a1b', 'c2', 'read_file', { path: 'b.txt' }),
            toolResult('t1', 'c1', 'read_file', padFact(`A_UNIQUE_${RESTATED_FACT}`, 3500)),
            toolResult('t2', 'c2', 'read_file', padFact(`B_UNIQUE_${LISTING_FACT}`, 3500))
          ],
          neededFacts: [RESTATED_FACT, LISTING_FACT]
        }
      ]
    },
    {
      id: 'call_index_survives',
      title: '抽离后调用线索还在，正文不在',
      hypothesis:
        'tool_call 参数（路径）仍可见，所以还能再 read_file；只活在 tool_result 里的 hash 会丢。bash ls 的 listing 不能靠 read 找回。',
      snapshots: [
        {
          id: 'after_consume',
          when: '助手已写正文，用户追问文件内容',
          messages: [
            user('u1', 'Read the ledger'),
            assistantToolCall('a1', 'c1', 'read_file', { path: LISTING_FACT }),
            toolResult('t1', 'c1', 'read_file', fileBody),
            assistantText('a2', 'I have read the ledger file.'),
            user('u2', 'What is the ledger hash?')
          ],
          neededFacts: [LISTING_FACT, FILE_BODY_FACT]
        },
        {
          id: 'ls_stdout_only',
          when: 'ls 结果被消费后，文件名只活在 stdout',
          messages: [
            user('u1', 'List files'),
            assistantToolCall('a1', 'c1', 'bash', { command: 'ls' }),
            toolResult('t1', 'c1', 'bash', listing),
            assistantText('a2', 'Listed the directory.'),
            user('u2', 'What was the ledger filename?')
          ],
          neededFacts: [LISTING_FACT]
        }
      ]
    }
  ];
}

export function runToolResultEvictExperiment(
  cases: ExperimentCase[] = buildExperimentCases()
): ExperimentReport {
  const reports: CaseReport[] = cases.map((experimentCase) => ({
    id: experimentCase.id,
    title: experimentCase.title,
    hypothesis: experimentCase.hypothesis,
    snapshots: experimentCase.snapshots.map((snapshot) => {
      const baselineTokens = estimateMessageTokens(snapshot.messages);
      return {
        id: snapshot.id,
        when: snapshot.when,
        baselineTokens,
        scores: EXPERIMENT_POLICIES.map((policy) => scorePolicy(policy, snapshot))
      };
    })
  }));

  return {
    generatedAt: new Date().toISOString(),
    policies: EXPERIMENT_POLICIES,
    cases: reports,
    verdicts: deriveVerdicts(reports)
  };
}

function scoreOf(
  report: ExperimentReport,
  caseId: string,
  snapshotId: string,
  policy: ExperimentPolicyId
): PolicyScore {
  const experimentCase = report.cases.find((item) => item.id === caseId);
  const snapshot = experimentCase?.snapshots.find((item) => item.id === snapshotId);
  const score = snapshot?.scores.find((item) => item.policy === policy);
  if (!score) {
    throw new Error(`missing score ${caseId}/${snapshotId}/${policy}`);
  }
  return score;
}

function deriveVerdicts(cases: CaseReport[]): string[] {
  const report: ExperimentReport = {
    generatedAt: '',
    policies: EXPERIMENT_POLICIES,
    cases,
    verdicts: []
  };

  const consumeKeep0 = scoreOf(report, 'unconsumed_wave', 'pending', 'keep_recent_0');
  const consumeAfter = scoreOf(report, 'unconsumed_wave', 'pending', 'after_any_assistant');
  const silentFollow = scoreOf(report, 'silent_digest', 'followup_turn', 'after_any_assistant');
  const restatedFollow = scoreOf(report, 'restated_digest', 'followup_turn', 'after_any_assistant');
  const streakAfterAny = scoreOf(report, 'tool_streak', 'after_read_call', 'after_any_assistant');
  const streakAfterText = scoreOf(report, 'tool_streak', 'after_read_call', 'after_text_assistant');
  const manyNone = scoreOf(report, 'many_dumps', 'after_ten', 'none');
  const manyKeep3 = scoreOf(report, 'many_dumps', 'after_ten', 'keep_recent_3');
  const manyAfter = scoreOf(report, 'many_dumps', 'after_ten', 'after_any_assistant');
  const debugAfter = scoreOf(report, 'debug_retry', 'after_retries', 'after_any_assistant');
  const debugKeep3 = scoreOf(report, 'debug_retry', 'after_retries', 'keep_recent_3');
  const indexAfter = scoreOf(report, 'call_index_survives', 'after_consume', 'after_text_assistant');
  const lsStdout = scoreOf(report, 'call_index_survives', 'ls_stdout_only', 'after_text_assistant');

  return [
    consumeAfter.missingFacts.length === 0 && consumeKeep0.missingFacts.length > 0
      ? 'PASS: after_* 在模型开口前保留全文；keep_recent=0 会误删未消费结果。'
      : 'FAIL: 未消费保护不符合预期。',
    restatedFollow.missingFacts.length === 0
      ? 'PASS: 助手已复述的事实，消费后抽离仍可找回。'
      : 'FAIL: 复述事实在抽离后丢失。',
    silentFollow.missingFacts.length > 0
      ? 'PASS: 助手未复述时，消费后抽离会丢路径/文件名（效果有损）。'
      : 'FAIL: silent_digest 未表现出预期信息损失。',
    streakAfterAny.missingFacts.includes(OTHER_FILE_FACT) &&
    !streakAfterText.missingFacts.includes(OTHER_FILE_FACT)
      ? 'PASS: 连续 tool_call 无正文时，after_any 过早抽离 ls；after_text 更稳。'
      : 'FAIL: tool_streak 两种 after_* 差异不符合预期。',
    manyAfter.tokens < manyKeep3.tokens && manyKeep3.tokens < manyNone.tokens
      ? `PASS: 十轮大输出 after_any 最省（${manyAfter.tokens} < ${manyKeep3.tokens} < ${manyNone.tokens} tok）。`
      : 'FAIL: 多轮压缩量排序不符合 after_any < keep_recent_3 < none。',
    debugAfter.missingFacts.includes(ERROR_FACT) && debugKeep3.missingFacts.includes(ERROR_FACT)
      ? 'PASS: 早期失败栈在多次工具后，after_any 与默认 keep_recent=3 都会丢（默认也不是无损）。'
      : debugAfter.missingFacts.includes(ERROR_FACT)
        ? 'PASS: after_any 丢掉早期错误码；keep_recent=3 仍留着（默认更保守）。'
        : 'FAIL: debug_retry 未丢掉预期错误码。',
    !indexAfter.missingFacts.includes(LISTING_FACT) &&
    indexAfter.missingFacts.includes(FILE_BODY_FACT)
      ? 'PASS: 抽离后仍留 tool_call 路径线索；文件正文丢失（可再 read_file，不能从占位还原 hash）。'
      : 'FAIL: call_index_survives 未同时保住路径、丢掉正文。',
    lsStdout.missingFacts.includes(LISTING_FACT)
      ? 'PASS: ls 文件名只活在 stdout 时，抽离后 read_file 找不到这条线索。'
      : 'FAIL: ls_stdout_only 未丢掉仅存在于 listing 的文件名。'
  ];
}

export function formatExperimentReport(report: ExperimentReport): string {
  const lines: string[] = [
    'Tool-result eviction experiment',
    `generated ${report.generatedAt}`,
    ''
  ];
  for (const experimentCase of report.cases) {
    lines.push(`## ${experimentCase.id} — ${experimentCase.title}`);
    lines.push(experimentCase.hypothesis);
    for (const snapshot of experimentCase.snapshots) {
      lines.push(`  snapshot ${snapshot.id} (${snapshot.when})`);
      lines.push(`  baseline ≈ ${snapshot.baselineTokens} tok`);
      for (const score of snapshot.scores) {
        const facts = `${score.factsKept}/${score.factsTotal} facts`;
        const miss =
          score.missingFacts.length > 0 ? ` missing=${score.missingFacts.join(',')}` : '';
        lines.push(
          `    ${score.policy.padEnd(22)} ${String(score.tokens).padStart(6)} tok  ` +
            `-${score.tokenSavePct.toFixed(1)}%  collapsed=${score.collapsed}  ${facts}${miss}`
        );
      }
    }
    lines.push('');
  }
  lines.push('Verdicts');
  for (const verdict of report.verdicts) {
    lines.push(`- ${verdict}`);
  }
  return lines.join('\n');
}
