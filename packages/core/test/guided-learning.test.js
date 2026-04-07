import assert from 'node:assert/strict';
import { test } from 'node:test';
import { builtinSkills, matchSkills } from '../dist/skills/builtin-skills.js';

test('guided-learning skill: properties and trigger words', () => {
  const skill = builtinSkills.find(s => s.id === 'guided-learning');
  assert.ok(skill, 'Guided learning skill should exist');
  assert.equal(skill.name, 'Guided learning');
  assert.ok(skill.triggerWords.includes('learn'));
  assert.ok(skill.triggerWords.includes('guide me'));
  assert.ok(skill.triggerWords.includes('hint'));
  assert.ok(skill.triggerWords.includes('review my work'));
});

test('guided-learning skill: keyword matching', () => {
  const queries = [
    'I want to learn how to use this library',
    'Can you guide me through the implementation?',
    'Give me a hint please',
    'Review my work for errors',
    'Lets use a plan.md for this'
  ];

  for (const q of queries) {
    const matched = matchSkills(q, builtinSkills);
    assert.ok(
      matched.some(s => s.id === 'guided-learning'),
      `Query "${q}" should match guided-learning skill`
    );
  }
});

test('guided-learning skill: content requirements', () => {
  const skill = builtinSkills.find(s => s.id === 'guided-learning');
  assert.ok(skill.content.includes('stepwise plan'), 'Should mention stepwise plan');
  assert.ok(skill.content.includes('plan.md'), 'Should mention plan.md');
  assert.ok(skill.content.includes('hint'), 'Should mention hint');
  assert.ok(skill.content.includes('review'), 'Should mention review');
  assert.ok(skill.content.includes('not takeover'), 'Should mention not taking over');
});
