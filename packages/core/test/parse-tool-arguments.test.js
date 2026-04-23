import assert from 'node:assert/strict';
import test from 'node:test';
import { parseModelToolArguments } from '../dist/model/parse-tool-arguments.js';

test('parseModelToolArguments parses valid JSON object', () => {
  assert.deepEqual(parseModelToolArguments('{"a":1}'), { a: 1 });
});

test('parseModelToolArguments repairs trailing comma', () => {
  assert.deepEqual(parseModelToolArguments('{"a":1,}'), { a: 1 });
});

test('parseModelToolArguments repairs unquoted keys', () => {
  const r = parseModelToolArguments('{a:1}');
  assert.equal(r.a, 1);
});

test('parseModelToolArguments wraps repaired non-object as _nonObject', () => {
  const r = parseModelToolArguments('not json at all');
  assert.equal(r._nonObject, 'not json at all');
});

test('parseModelToolArguments empty becomes empty object', () => {
  assert.deepEqual(parseModelToolArguments(''), {});
  assert.deepEqual(parseModelToolArguments(null), {});
});
