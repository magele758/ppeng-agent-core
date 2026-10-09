import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPatch,
  changedKeys,
  formatListInput,
  isDefaultValue,
  isDirty,
  parseIntInRange,
  parseListInput
} from './settings-fields.ts';

test('整数范围校验拒绝越界、小数、空串与非数字 [AC:settings-categories#AC-5]', () => {
  assert.deepEqual(parseIntInRange('25', 1, 100), { ok: true, value: 25 });
  assert.deepEqual(parseIntInRange(' 7 ', 1, 100), { ok: true, value: 7 });
  assert.deepEqual(parseIntInRange('1', 1, 100), { ok: true, value: 1 });
  assert.deepEqual(parseIntInRange('100', 1, 100), { ok: true, value: 100 });
  for (const bad of ['0', '101', '', '  ', '3.5', 'abc', '1e2', '-1']) {
    assert.deepEqual(parseIntInRange(bad, 1, 100), { ok: false }, `should reject ${JSON.stringify(bad)}`);
  }
});

test('默认值比较支持原始值与数组 [AC:settings-categories#AC-3]', () => {
  assert.equal(isDefaultValue('auto', 'auto'), true);
  assert.equal(isDefaultValue('fast', 'auto'), false);
  assert.equal(isDefaultValue(null, null), true);
  assert.equal(isDefaultValue(null, 5), false);
  assert.equal(isDefaultValue([], []), true);
  assert.equal(isDefaultValue(['a'], []), false);
});

test('未保存修改只统计真正变化的字段并生成最小 PATCH [AC:settings-categories#AC-4]', () => {
  const saved = { a: 1, b: 'x', c: ['h'] };
  const same = { a: 1, b: 'x', c: ['h'] };
  const keys = ['a', 'b', 'c'] as const;
  assert.equal(isDirty(same, saved, keys), false);
  assert.deepEqual(buildPatch(same, saved, keys), {});
  const draft = { a: 2, b: 'x', c: ['h', 'i'] };
  assert.equal(isDirty(draft, saved, keys), true);
  assert.deepEqual(changedKeys(draft, saved, keys), ['a', 'c']);
  assert.deepEqual(buildPatch(draft, saved, keys), { a: 2, c: ['h', 'i'] });
});

test('列表输入按逗号或换行拆分并去重去空 [AC:settings-categories#AC-4]', () => {
  assert.deepEqual(parseListInput('a.com, b.com\n,a.com ,, '), ['a.com', 'b.com']);
  assert.deepEqual(parseListInput(''), []);
  assert.equal(formatListInput(['a', 'b']), 'a, b');
  assert.equal(formatListInput(undefined), '');
});
