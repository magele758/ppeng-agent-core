import test from 'node:test';
import assert from 'node:assert/strict';
import { discloseSkillBody, formatDisclosedSkillContent } from '../dist/skills/skill-disclosure.js';

test('discloseSkillBody cuts at References section', () => {
  const intro = 'Intro paragraph. '.repeat(20);
  const body = `# Skill\n\n${intro}\n\n## How to Run\nDo X.\n\n## References\nHuge blob that must be omitted\n`;
  const r = discloseSkillBody(body);
  assert.equal(r.truncated, true);
  assert.ok(!r.disclosed.includes('Huge blob'));
  assert.ok(formatDisclosedSkillContent(r).includes('Progressive disclosure'));
});

test('discloseSkillBody respects maxChars', () => {
  const r = discloseSkillBody('a'.repeat(5000), { maxChars: 100, progressive: false });
  assert.equal(r.truncated, true);
  assert.ok(r.disclosed.length <= 100);
});
