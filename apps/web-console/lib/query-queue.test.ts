import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapSteerInboxItems,
  parseQueryExecMode,
  queryExecModeOf,
  steerBodyFromQueryMode
} from './query-queue.ts';

test('parseQueryExecMode accepts aliases and rejects junk', () => {
  assert.equal(parseQueryExecMode('steering'), 'steering');
  assert.equal(parseQueryExecMode('steer'), 'steering');
  assert.equal(parseQueryExecMode('prompt'), 'steering');
  assert.equal(parseQueryExecMode('subagent'), 'subagent');
  assert.equal(parseQueryExecMode('queue'), undefined);
  assert.equal(parseQueryExecMode(''), undefined);
  assert.equal(parseQueryExecMode(null), undefined);
});

test('queryExecModeOf defaults to steering', () => {
  assert.equal(queryExecModeOf(undefined), 'steering');
  assert.equal(queryExecModeOf({ mode: 'subagent' }), 'subagent');
  assert.equal(queryExecModeOf({ mode: 'steering' }), 'steering');
  assert.equal(queryExecModeOf({}), 'steering');
});

test('steerBodyFromQueryMode only sets subagent', () => {
  assert.deepEqual(steerBodyFromQueryMode('steering'), {});
  assert.deepEqual(steerBodyFromQueryMode('subagent'), { mode: 'subagent' });
});

test('mapSteerInboxItems normalizes shape and mode', () => {
  assert.deepEqual(mapSteerInboxItems(null), []);
  assert.deepEqual(
    mapSteerInboxItems([
      { id: 'a', text: 'hello', target: 'next-run', createdAt: 't', steerMode: 'subagent' },
      { id: 1, text: 'skip' },
      { text: 'no-id' }
    ]),
    [{ id: 'a', text: 'hello', target: 'next-run', createdAt: 't', mode: 'subagent' }]
  );
});
