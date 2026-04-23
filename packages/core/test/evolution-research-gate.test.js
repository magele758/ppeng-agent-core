import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCursorModelListOutput } from '../../../scripts/evolution/cursor-models.mjs';
import { parseResearchDecisionOutput } from '../../../scripts/evolution/research-gate.mjs';

test('parseResearchDecisionOutput 识别 markdown 包裹的 SKIP 行', () => {
  const parsed = parseResearchDecisionOutput('**SKIP: IRRELEVANT** — not applicable to this codebase');

  assert.equal(parsed.decision, 'SKIP');
  assert.equal(parsed.skipType, 'IRRELEVANT');
});

test('parseResearchDecisionOutput 在缺少 excerpt 时直接跳过', () => {
  const parsed = parseResearchDecisionOutput('anything', { hasUsableExcerpt: false });

  assert.equal(parsed.decision, 'SKIP');
  assert.equal(parsed.skipType, 'IRRELEVANT');
  assert.match(parsed.reason, /excerpt/i);
});

test('parseResearchDecisionOutput 在模型不可用时不再默认 PROCEED', () => {
  const parsed = parseResearchDecisionOutput(
    'Cannot use this model: composer-2-fast. Available models: auto, composer-2'
  );

  assert.equal(parsed.decision, 'SKIP');
  assert.equal(parsed.skipType, 'OUTDATED');
  assert.match(parsed.reason, /composer-2-fast/);
});

test('parseResearchDecisionOutput 支持前置说明后再给 PROCEED', () => {
  const parsed = parseResearchDecisionOutput(`检索结果如下\nPROCEED\npackages/core/src/runtime.ts needs a small guard`);

  assert.equal(parsed.decision, 'PROCEED');
  assert.match(parsed.reason, /runtime\.ts/);
});

test('parseCursorModelListOutput 解析 agent --list-models 输出', () => {
  const output = `Loading models...
Available models

auto - Auto
composer-2-fast - Composer 2 Fast  (default)
gpt-5.4-high - GPT-5.4 1M High  (current)
`;

  assert.deepEqual(parseCursorModelListOutput(output), [
    'auto',
    'composer-2-fast',
    'gpt-5.4-high'
  ]);
});
