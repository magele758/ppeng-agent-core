import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeSkillsByName } from '../dist/builtin-skills.js';

test('mergeSkillsByName: agents override workspace on same name', () => {
  const ws = [{ id: 'a', name: 'Foo', description: 'w', source: 'workspace' }];
  const ag = [{ id: 'a', name: 'Foo', description: 'g', source: 'agents' }];
  const m = mergeSkillsByName(ws, ag);
  assert.equal(m.length, 1);
  assert.equal(m[0].description, 'g');
  assert.equal(m[0].source, 'agents');
});
