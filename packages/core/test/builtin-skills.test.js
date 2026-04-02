import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadWorkspaceSkills, mergeSkillsByName, parseSkillFrontmatter } from '../dist/builtin-skills.js';

test('mergeSkillsByName: agents override workspace on same name', () => {
  const ws = [{ id: 'a', name: 'Foo', description: 'w', source: 'workspace' }];
  const ag = [{ id: 'a', name: 'Foo', description: 'g', source: 'agents' }];
  const m = mergeSkillsByName(ws, ag);
  assert.equal(m.length, 1);
  assert.equal(m[0].description, 'g');
  assert.equal(m[0].source, 'agents');
});

test('parseSkillFrontmatter: parses aliases and trigger word lists', () => {
  const parsed = parseSkillFrontmatter(`---
name: "Calendar Helper"
description: 'Schedules meetings'
aliases: [calendar-helper, planner]
triggerWords:
  - meeting
  - schedule
---
Use this skill for planning meetings.
`);

  assert.equal(parsed.meta.name, 'Calendar Helper');
  assert.equal(parsed.meta.description, 'Schedules meetings');
  assert.deepEqual(parsed.meta.aliases, ['calendar-helper', 'planner']);
  assert.deepEqual(parsed.meta.triggerWords, ['meeting', 'schedule']);
  assert.equal(parsed.body, 'Use this skill for planning meetings.');
});

test('loadWorkspaceSkills: maps frontmatter aliases and trigger words onto SkillSpec', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-core-skills-'));
  const skillDir = join(root, 'skills', 'calendar-helper');
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, 'SKILL.md'),
    `---
name: Calendar Helper
description: Coordinate calendars
id: calendar-skill
aliases:
  - calendar-helper
  - meeting planner
keywords:
  - meeting
  - invite
---
Schedule meetings and coordinate invites.
`,
    'utf8'
  );

  const skills = await loadWorkspaceSkills(root);
  assert.equal(skills.length, 1);
  assert.equal(skills[0].id, 'calendar-skill');
  assert.deepEqual(skills[0].aliases, ['calendar-helper', 'meeting planner']);
  assert.deepEqual(skills[0].triggerWords, ['meeting', 'invite']);
  assert.equal(skills[0].skillPath, 'skills/calendar-helper/SKILL.md');
});
