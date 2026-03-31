import test from 'node:test';
import assert from 'node:assert/strict';
import { createId, nowIso } from '../dist/id.js';

test('createId returns string with prefix', () => {
  const id = createId('session');
  assert.ok(typeof id === 'string');
  assert.ok(id.startsWith('session_'));
});

test('createId generates unique ids', () => {
  const ids = new Set();
  for (let i = 0; i < 100; i++) {
    ids.add(createId('test'));
  }
  assert.equal(ids.size, 100, 'All generated IDs should be unique');
});

test('createId generates 32 hex chars after prefix', () => {
  const id = createId('x');
  const parts = id.split('_');
  assert.equal(parts.length, 2);
  assert.equal(parts[1].length, 32, 'UUID without dashes should be 32 hex chars');
  assert.ok(/^[a-f0-9]{32}$/.test(parts[1]), 'Should be lowercase hex');
});

test('createId handles empty prefix', () => {
  const id = createId('');
  assert.ok(id.startsWith('_'));
});

test('createId handles prefix with underscore', () => {
  const id = createId('my_prefix');
  assert.ok(id.startsWith('my_prefix_'));
  const parts = id.split('_');
  // prefix_my_prefix + uuid
  assert.equal(parts.length, 3);
});

test('nowIso returns ISO 8601 string', () => {
  const iso = nowIso();
  assert.ok(typeof iso === 'string');
  // ISO format: YYYY-MM-DDTHH:MM:SS.sssZ
  assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(iso));
});

test('nowIso returns current time', () => {
  const before = Date.now();
  const iso = nowIso();
  const after = Date.now();
  const parsed = new Date(iso).getTime();
  assert.ok(parsed >= before && parsed <= after, 'nowIso should return current time');
});

test('nowIso is valid Date', () => {
  const iso = nowIso();
  const date = new Date(iso);
  assert.ok(!isNaN(date.getTime()), 'Should parse to valid Date');
});
