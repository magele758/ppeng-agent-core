import test from 'node:test';
import assert from 'node:assert/strict';
import { filterSessionsByQuery } from '../dist/session-query.js';

const base = {
  id: 'sess-abc-123',
  title: 'Shop floor notes',
  mode: 'chat',
  status: 'idle',
  agentId: 'general',
};

test('filterSessionsByQuery empty q returns copy of all', () => {
  const rows = [base];
  const out = filterSessionsByQuery(rows, '');
  assert.deepEqual(out, rows);
  assert.notEqual(out, rows);
});

test('filterSessionsByQuery matches title case-insensitively', () => {
  const rows = [base, { ...base, id: 'x', title: 'Other' }];
  const out = filterSessionsByQuery(rows, 'SHOP');
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'sess-abc-123');
});

test('filterSessionsByQuery matches id substring', () => {
  const rows = [base];
  const out = filterSessionsByQuery(rows, 'abc');
  assert.equal(out.length, 1);
});

test('filterSessionsByQuery matches agentId', () => {
  const rows = [base];
  assert.equal(filterSessionsByQuery(rows, 'general').length, 1);
  assert.equal(filterSessionsByQuery(rows, 'nope').length, 0);
});

test('filterSessionsByQuery uses optional fields when present', () => {
  const rows = [{ ...base, taskId: 'task-99' }];
  assert.equal(filterSessionsByQuery(rows, '99').length, 1);
});
