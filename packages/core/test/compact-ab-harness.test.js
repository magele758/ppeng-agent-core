import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RawAgentRuntime } from '../dist/runtime.js';
import { writeCompactSettings } from '../dist/session/compact-settings.js';
import {
  answerRecallsToken,
  buildCompactAbSeed,
  compactAbPolicyConfig,
  formatCompactAbReport,
  parseCaseList,
  parsePolicyList,
  previewCompactAbView,
  seedMessages,
  seedParts,
  summarizeCompactAbRuns
} from '../dist/session/compact-ab-harness.js';
import { microCompactMessages } from '../dist/session/micro-compact.js';

test('parse lists default to keep_recent + after_text / silent', () => {
  assert.deepEqual(parsePolicyList(undefined), ['keep_recent', 'after_text_assistant']);
  assert.deepEqual(parsePolicyList('after_any_assistant,keep_recent,nope'), [
    'after_any_assistant',
    'keep_recent'
  ]);
  assert.deepEqual(parseCaseList(''), ['silent']);
  assert.deepEqual(parseCaseList('silent,restated,silent'), ['silent', 'restated']);
});

test('silent seed: after_text drops the token, keep_recent keeps it', () => {
  const artifact = '/var/lib/ppeng/releases/rel_deadbeef00/gateway.tgz';
  const seed = buildCompactAbSeed({ token: artifact, caseId: 'silent', minChars: 2400 });
  assert.match(seed.dump, /=== host ===/);
  assert.match(seed.dump, /=== git ===/);
  assert.match(seed.dump, /=== last-deploy ===/);
  assert.match(seed.dump, /=== logs\/gateway ===/);
  assert.ok(seed.dump.includes(`artifact: ${artifact}`));
  assert.equal(seed.dump.includes('SECRET_TOKEN='), false);
  assert.ok(seed.dump.length > 2000);
  assert.equal(seed.consumedText.includes(seed.token), false);
  assert.equal(seed.command.includes(seed.token), false, 'command must not leak the artifact path');
  assert.equal(seed.followUp.includes(seed.token), false);

  const keep = previewCompactAbView('keep_recent', seed);
  const afterText = previewCompactAbView('after_text_assistant', seed);
  const afterAny = previewCompactAbView('after_any_assistant', seed);

  assert.equal(keep.tokenInView, true);
  assert.equal(keep.collapsed, 0);
  assert.equal(afterText.tokenInView, false);
  assert.equal(afterText.collapsed, 1);
  assert.equal(afterAny.tokenInView, false);
  assert.ok(afterText.charsSaved > 0);
  assert.ok(afterText.tokens < keep.tokens);

  const live = microCompactMessages(seedMessages(seed), compactAbPolicyConfig('after_text_assistant'));
  assert.match(live.messages[2].parts[0].content, /output dropped from context/);
});

test('restated seed keeps the token after after_text eviction', () => {
  const seed = buildCompactAbSeed({
    token: '/var/lib/ppeng/releases/rel_restated01/gateway.tgz',
    caseId: 'restated',
    minChars: 2400
  });
  const afterText = previewCompactAbView('after_text_assistant', seed);
  assert.equal(afterText.collapsed, 1);
  assert.equal(afterText.tokenInView, true, 'assistant restated the token');
});

test('answerRecallsToken and report summary flag quality regression', () => {
  const path = '/var/lib/ppeng/releases/rel_aaa/gateway.tgz';
  assert.equal(answerRecallsToken(path, path), true);
  assert.equal(answerRecallsToken(`artifact is ${path}`, path), true);
  assert.equal(answerRecallsToken('nope', path), false);

  const summary = summarizeCompactAbRuns([
    {
      policy: 'keep_recent',
      caseId: 'silent',
      token: 'T',
      recalled: true,
      expectedTokenInView: true,
      collapsed: 0,
      charsSaved: 0,
      viewTokens: 200,
      baselineTokens: 200,
      usage: { inputTokens: 900, outputTokens: 8, totalTokens: 908, requests: 1 },
      elapsedMs: 10,
      answerPreview: 'T'
    },
    {
      policy: 'after_text_assistant',
      caseId: 'silent',
      token: 'T',
      recalled: false,
      expectedTokenInView: false,
      collapsed: 1,
      charsSaved: 700,
      viewTokens: 80,
      baselineTokens: 200,
      usage: { inputTokens: 400, outputTokens: 12, totalTokens: 412, requests: 1 },
      elapsedMs: 12,
      answerPreview: 'unknown'
    }
  ]);
  assert.equal(summary.qualityRegression, true);
  assert.equal(summary.completed, 2);
  assert.equal(summary.inputTokensByPolicy.keep_recent, 900);
  assert.equal(summary.inputTokensByPolicy.after_text_assistant, 400);

  const text = formatCompactAbReport({
    generatedAt: '2026-09-02T00:00:00.000Z',
    adapter: 'test',
    model: 'm',
    runs: [],
    summary
  });
  assert.match(text, /quality_regression=true/);
});

test('runtime follow-up sees stubbed dump under after_text, verbatim under keep_recent', async () => {
  const liveToken = '/var/lib/ppeng/releases/rel_liveview01/gateway.tgz';
  const seed = buildCompactAbSeed({ token: liveToken, caseId: 'silent', minChars: 2400 });

  async function capturedDump(policy) {
    const seen = [];
    const runtime = new RawAgentRuntime({
      repoRoot: mkdtempSync(join(tmpdir(), 'cab-repo-')),
      stateDir: mkdtempSync(join(tmpdir(), 'cab-state-')),
      modelAdapter: {
        name: 'stub',
        async runTurn(input) {
          for (const message of input.messages) {
            for (const part of message.parts) {
              if (part.type === 'tool_result') seen.push(part.content);
            }
          }
          return { stopReason: 'end', assistantParts: [{ type: 'text', text: liveToken }] };
        },
        async summarizeMessages() {
          return 'summary';
        }
      }
    });
    writeCompactSettings(runtime.store, { policy, keepRecent: policy === 'keep_recent' ? 3 : 0 });
    const session = runtime.createChatSession({
      title: `plumbing ${policy}`,
      agentId: 'general',
      message: seed.firstUser
    });
    const parts = seedParts(seed);
    runtime.store.appendMessage(session.id, 'assistant', parts.assistantToolCall);
    runtime.store.appendMessage(session.id, 'tool', parts.toolResult);
    runtime.store.appendMessage(session.id, 'assistant', parts.assistantConsumed);
    runtime.sendUserMessage(session.id, seed.followUp);
    await runtime.runSession(session.id);
    await runtime.destroy();
    return seen.join('\n');
  }

  const keepView = await capturedDump('keep_recent');
  const afterView = await capturedDump('after_text_assistant');
  assert.match(keepView, /rel_liveview01/);
  assert.match(afterView, /output dropped from context/);
  assert.equal(afterView.includes(liveToken), false);
});
