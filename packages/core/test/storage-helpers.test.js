import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  serializeJson,
  parseJson,
  optionalString,
  boolToInt,
  intToBool,
} from '../dist/stores/storage-helpers.js';

describe('serializeJson', () => {
  it('serializes a plain object', () => {
    assert.equal(serializeJson({ a: 1 }), '{"a":1}');
  });

  it('serializes nested objects', () => {
    const input = { a: { b: [1, 2, { c: true }] } };
    assert.equal(serializeJson(input), JSON.stringify(input));
  });

  it('converts null to "null"', () => {
    assert.equal(serializeJson(null), 'null');
  });

  it('converts undefined to "null"', () => {
    assert.equal(serializeJson(undefined), 'null');
  });

  it('serializes an empty object', () => {
    assert.equal(serializeJson({}), '{}');
  });

  it('serializes strings and numbers', () => {
    assert.equal(serializeJson('hello'), '"hello"');
    assert.equal(serializeJson(42), '42');
  });

  it('handles Unicode and special characters', () => {
    const input = { emoji: '🚀', cjk: '你好', tab: 'a\tb' };
    assert.deepStrictEqual(JSON.parse(serializeJson(input)), input);
  });

  it('handles a large object', () => {
    const big = Object.fromEntries(
      Array.from({ length: 500 }, (_, i) => [`k${i}`, i]),
    );
    const result = serializeJson(big);
    assert.deepStrictEqual(JSON.parse(result), big);
  });
});

describe('parseJson', () => {
  it('parses valid JSON', () => {
    assert.deepStrictEqual(parseJson('{"a":1}'), { a: 1 });
  });

  it('returns null for null input', () => {
    assert.equal(parseJson(null), null);
  });

  it('returns null for empty string', () => {
    assert.equal(parseJson(''), null);
  });

  it('throws on invalid JSON', () => {
    assert.throws(() => parseJson('not-json'));
  });

  it('round-trips with serializeJson', () => {
    const original = { x: [1, 'two', null, true] };
    assert.deepStrictEqual(parseJson(serializeJson(original)), original);
  });

  it('parses Unicode content', () => {
    assert.deepStrictEqual(parseJson('{"k":"日本語"}'), { k: '日本語' });
  });
});

describe('optionalString', () => {
  it('returns a non-empty string as-is', () => {
    assert.equal(optionalString('hello'), 'hello');
  });

  it('returns undefined for empty string', () => {
    assert.equal(optionalString(''), undefined);
  });

  it('returns undefined for null', () => {
    assert.equal(optionalString(null), undefined);
  });

  it('returns undefined for undefined', () => {
    assert.equal(optionalString(undefined), undefined);
  });

  it('returns undefined for non-string values', () => {
    assert.equal(optionalString(42), undefined);
    assert.equal(optionalString(true), undefined);
    assert.equal(optionalString({}), undefined);
  });

  it('preserves whitespace-only strings', () => {
    assert.equal(optionalString('  '), '  ');
  });
});

describe('boolToInt', () => {
  it('converts true to 1', () => {
    assert.equal(boolToInt(true), 1);
  });

  it('converts false to 0', () => {
    assert.equal(boolToInt(false), 0);
  });
});

describe('intToBool', () => {
  it('converts 1 to true', () => {
    assert.equal(intToBool(1), true);
  });

  it('converts 0 to false', () => {
    assert.equal(intToBool(0), false);
  });

  it('converts string "1" to true', () => {
    assert.equal(intToBool('1'), true);
  });

  it('returns false for other numbers', () => {
    assert.equal(intToBool(2), false);
    assert.equal(intToBool(-1), false);
  });

  it('returns false for null and undefined', () => {
    assert.equal(intToBool(null), false);
    assert.equal(intToBool(undefined), false);
  });
});
