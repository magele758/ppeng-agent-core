import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { envInt, envBool } from '@ppeng/agent-core';

describe('envInt', () => {
  it('returns fallback when key is missing', () => {
    assert.equal(envInt({}, 'MISSING', 42), 42);
  });

  it('returns fallback when value is empty string', () => {
    assert.equal(envInt({ X: '' }, 'X', 10), 10);
  });

  it('returns fallback when value is not a number', () => {
    assert.equal(envInt({ X: 'abc' }, 'X', 10), 10);
  });

  it('returns fallback when value is zero', () => {
    assert.equal(envInt({ X: '0' }, 'X', 10), 10);
  });

  it('returns fallback when value is negative', () => {
    assert.equal(envInt({ X: '-5' }, 'X', 10), 10);
  });

  it('returns fallback when value is NaN', () => {
    assert.equal(envInt({ X: 'NaN' }, 'X', 10), 10);
  });

  it('returns fallback when value is Infinity', () => {
    assert.equal(envInt({ X: 'Infinity' }, 'X', 10), 10);
  });

  it('parses valid positive integer', () => {
    assert.equal(envInt({ X: '100' }, 'X', 10), 100);
  });

  it('floors fractional values', () => {
    assert.equal(envInt({ X: '3.7' }, 'X', 10), 3);
  });
});

describe('envBool', () => {
  it('returns defaultVal when key is missing', () => {
    assert.equal(envBool({}, 'MISSING', true), true);
    assert.equal(envBool({}, 'MISSING', false), false);
  });

  it('returns defaultVal when value is empty', () => {
    assert.equal(envBool({ X: '' }, 'X', true), true);
    assert.equal(envBool({ X: '' }, 'X', false), false);
  });

  describe('when defaultVal is true', () => {
    it('stays true for unrecognized values', () => {
      assert.equal(envBool({ X: 'yes' }, 'X', true), true);
      assert.equal(envBool({ X: '1' }, 'X', true), true);
      assert.equal(envBool({ X: 'anything' }, 'X', true), true);
    });

    for (const val of ['0', 'false', 'no', 'off', 'FALSE', 'No', 'OFF']) {
      it(`disables for '${val}'`, () => {
        assert.equal(envBool({ X: val }, 'X', true), false);
      });
    }
  });

  describe('when defaultVal is false', () => {
    it('stays false for unrecognized values', () => {
      assert.equal(envBool({ X: 'anything' }, 'X', false), false);
      assert.equal(envBool({ X: '0' }, 'X', false), false);
    });

    for (const val of ['1', 'true', 'yes', 'on', 'TRUE', 'Yes', 'ON']) {
      it(`enables for '${val}'`, () => {
        assert.equal(envBool({ X: val }, 'X', false), true);
      });
    }
  });
});
