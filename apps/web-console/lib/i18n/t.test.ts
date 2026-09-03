import test from 'node:test';
import assert from 'node:assert/strict';
import { en } from './messages/en/index.ts';
import { zh } from './messages/zh/index.ts';
import { getMessage, interpolate, translate } from './t.ts';

test('interpolate replaces known placeholders and keeps unknown', () => {
  assert.equal(interpolate('发消息给 {name}…', { name: 'Ada' }), '发消息给 Ada…');
  assert.equal(interpolate('hello {name}', {}), 'hello {name}');
  assert.equal(interpolate('a {x} {y}', { x: 1 }), 'a 1 {y}');
  assert.equal(interpolate('no vars'), 'no vars');
  assert.equal(interpolate('{count} items', { count: 0 }), '0 items');
});

test('getMessage reads leaf paths and rejects non-leaves', () => {
  assert.equal(getMessage(zh, 'common.save'), '保存');
  assert.equal(getMessage(en, 'common.save'), 'Save');
  assert.equal(getMessage(zh, 'common.language'), '语言');
  assert.equal(getMessage(zh, 'common.missing'), undefined);
  assert.equal(getMessage(zh, 'common'), undefined);
  assert.equal(getMessage(zh, ''), undefined);
  assert.equal(getMessage(zh, 'nav.workbench'), '工作台');
});

test('translate returns known keys and interpolates', () => {
  assert.equal(translate(zh, 'common.confirm'), '确认');
  assert.equal(translate(en, 'common.confirm'), 'Confirm');
  assert.equal(translate(zh, 'common.saved'), '已保存，立即生效');
  const template = '发消息给 {name}…';
  assert.equal(interpolate(template, { name: 'Bot' }), '发消息给 Bot…');
});

test('translate falls back to zh then to the key itself', (t) => {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
  t.after(() => {
    console.warn = original;
  });

  const { language: _dropped, ...restCommon } = en.common;
  const enWithoutLanguage = { ...en, common: restCommon };
  assert.equal(translate(enWithoutLanguage, 'common.language', undefined, zh), '语言');
  assert.equal(translate(zh, 'common.not.a.key'), 'common.not.a.key');
  assert.ok(warnings.some((line) => line.includes('common.language')));
  assert.ok(warnings.some((line) => line.includes('common.not.a.key')));
});
