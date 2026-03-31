import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  buildSkillRouting,
  routeSkillsLexical,
  skillRoutingModeFromEnv,
  skillRoutingTopKFromEnv
} from '../dist/skill-router.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 与 skill-router-cases.json 中 topShouldInclude 对齐的微型 skill 池 */
function fixtureSkills() {
  return [
    {
      id: 'pretty-mermaid',
      name: 'Pretty Mermaid',
      description: 'Render Mermaid diagrams as SVG',
      content:
        'Use the beautiful-mermaid library. Supports flowchart, sequence, state. Themes: default, dark, forest.',
      source: 'workspace'
    },
    {
      id: 'postgres-tuning',
      name: 'Postgres Tuning',
      description: 'Database performance tips',
      content:
        'Analyze slow queries with EXPLAIN. Add btree indexes for equality and range predicates. Consider VACUUM and autovacuum.',
      source: 'workspace'
    },
    {
      id: 'skill-authoring',
      name: 'Skill Authoring',
      description: 'How to write agent skills',
      content:
        'SKILL.md front matter with name and description. Progressive disclosure: keep body long but load on demand.',
      source: 'workspace'
    },
    {
      id: 'lark-mail',
      name: 'Lark Mail',
      description: 'Feishu email',
      content: 'Compose and send mail via Lark. Not related to diagrams.',
      source: 'agents'
    },
    {
      id: 'zzz-fallback',
      name: 'ZZZ Fallback',
      description: 'Alphabetically last placeholder',
      content: 'zzz alphabetical tie-break',
      source: 'workspace'
    }
  ];
}

test('routeSkillsLexical: JSON cases top-4 include expected name', async () => {
  const raw = await readFile(join(__dirname, 'skill-router-cases.json'), 'utf8');
  const { cases } = JSON.parse(raw);
  const skills = fixtureSkills();
  for (const c of cases) {
    const ranked = routeSkillsLexical(c.query, skills, 4);
    const names = ranked.map((r) => r.skill.name);
    assert.ok(
      names.includes(c.topShouldInclude),
      `query=${JSON.stringify(c.query)} expected ${c.topShouldInclude} in top-4, got ${names.join(', ')}`
    );
  }
});

test('buildSkillRouting: legacy exposes full shortlist count', () => {
  const skills = fixtureSkills();
  const r = buildSkillRouting('postgres index', skills, { mode: 'legacy', topK: 3 });
  assert.equal(r.mode, 'legacy');
  assert.equal(r.shortlistNames.length, skills.length);
  assert.ok(r.keywordMatched.length >= 0);
});

test('buildSkillRouting: hybrid unions keyword and lexical', () => {
  const skills = [
    {
      id: 'tasks',
      name: 'Tasks',
      description: 'task list',
      content: 'task_create long lived',
      source: 'builtin',
      triggerWords: ['task']
    },
    ...fixtureSkills().filter((s) => s.name !== 'ZZZ Fallback')
  ];
  const r = buildSkillRouting('task and postgres', skills, { mode: 'hybrid', topK: 3 });
  assert.ok(r.shortlistNames.includes('Tasks'));
  assert.ok(r.shortlistNames.includes('Postgres Tuning'));
});

test('skillRouting env helpers', () => {
  assert.equal(skillRoutingTopKFromEnv({ RAW_AGENT_SKILL_ROUTING_TOP_K: '3' }), 3);
  assert.equal(skillRoutingTopKFromEnv({ RAW_AGENT_SKILL_ROUTING_TOP_K: 'not-a-number' }), 8);
  assert.equal(skillRoutingModeFromEnv({ RAW_AGENT_SKILL_ROUTING_MODE: 'legacy' }), 'legacy');
  assert.equal(skillRoutingModeFromEnv({ RAW_AGENT_SKILL_ROUTING_MODE: 'lexical' }), 'lexical');
  assert.equal(skillRoutingModeFromEnv({}), 'hybrid');
});
