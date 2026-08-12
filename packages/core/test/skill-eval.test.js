import test from 'node:test';
import assert from 'node:assert/strict';
import { runSkillEval, compareSkillEvalModes, generateSyntheticTestCases, DEFAULT_SKILL_EVAL_CASES } from '../dist/skills/skill-eval.js';

const mockSkills = [
  {
    id: 'postgres-tuning',
    name: 'Postgres Tuning',
    description: 'Optimize PostgreSQL queries, EXPLAIN ANALYZE, and indexes',
    content: 'Postgres query performance tuning and index creation guide',
    triggerWords: ['postgres', 'explain analyze', 'pg_stat_statements']
  },
  {
    id: 'pretty-mermaid',
    name: 'Pretty Mermaid',
    description: 'Render beautiful mermaid diagrams and flowcharts to SVG/PNG',
    content: 'Mermaid rendering skill for flowcharts, sequence diagrams, and architecture maps',
    triggerWords: ['mermaid', 'flowchart', 'sequence diagram']
  },
  {
    id: 'lark-mail',
    name: 'Lark Mail',
    description: 'Send and receive emails using Feishu/Lark mail API',
    content: 'Lark mail tool integration for composing and searching email messages',
    triggerWords: ['feishu mail', 'lark mail', 'email']
  }
];

test('runSkillEval calculates metrics correctly', async () => {
  const result = await runSkillEval({
    mode: 'hybrid',
    topK: 3,
    skills: mockSkills,
    testCases: DEFAULT_SKILL_EVAL_CASES
  });

  assert.equal(result.mode, 'hybrid');
  assert.equal(result.topK, 3);
  assert.ok(result.totalCases > 0);
  assert.ok(typeof result.passRate === 'number');
  assert.ok(result.passRate >= 0 && result.passRate <= 1);
  assert.ok(typeof result.mrr === 'number');
  assert.ok(typeof result.averageLatencyMs === 'number');
  assert.equal(result.details.length, result.totalCases);
});

test('compareSkillEvalModes evaluates multiple routing modes', async () => {
  const comparison = await compareSkillEvalModes({
    modes: ['legacy', 'lexical', 'hybrid'],
    topK: 3,
    skills: mockSkills,
    testCases: DEFAULT_SKILL_EVAL_CASES
  });

  assert.ok(comparison.summaries['legacy']);
  assert.ok(comparison.summaries['lexical']);
  assert.ok(comparison.summaries['hybrid']);
  assert.ok(comparison.summaries['hybrid-fusion']);
  assert.equal(comparison.totalSkillsCount, 3);
});

test('generateSyntheticTestCases extracts cases from skills', () => {
  const cases = generateSyntheticTestCases(mockSkills);
  assert.ok(cases.length > 0);
  const triggerCase = cases.find((c) => c.category === 'synthetic-trigger');
  assert.ok(triggerCase);
  assert.ok(triggerCase.query.includes('postgres'));
  assert.equal(triggerCase.topShouldInclude, 'Postgres Tuning');
});
