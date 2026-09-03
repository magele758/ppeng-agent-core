import test from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError } from '../dist/errors.js';
import { cron5Matches, nextCronRunAt, parseCron5 } from '../dist/cron/cron-next.js';

test('parseCron5 rejects non-5-field', () => {
  assert.throws(() => parseCron5('* * *'), ValidationError);
  assert.throws(() => parseCron5('a * * * *'), ValidationError);
});

test('parseCron5 star / lists / steps', () => {
  const daily = parseCron5('30 9 * * *');
  assert.deepEqual([...daily.minute], [30]);
  assert.deepEqual([...daily.hour], [9]);
  assert.equal(daily.dom, null);
  assert.equal(daily.dow, null);

  const weekdays = parseCron5('0 18 * * 1-5');
  assert.deepEqual([...weekdays.dow].sort((a, b) => a - b), [1, 2, 3, 4, 5]);

  const every5 = parseCron5('*/5 * * * *');
  assert.equal(every5.minute?.has(0), true);
  assert.equal(every5.minute?.has(5), true);
  assert.equal(every5.minute?.has(4), false);

  const sunday7 = parseCron5('0 9 * * 7');
  assert.deepEqual([...sunday7.dow], [0]);
});

test('cron5Matches: daily 09:30', () => {
  const cron = parseCron5('30 9 * * *');
  assert.equal(cron5Matches(cron, new Date(2026, 8, 3, 9, 30, 0)), true);
  assert.equal(cron5Matches(cron, new Date(2026, 8, 3, 9, 31, 0)), false);
});

test('cron5Matches: DOM or DOW when both restricted', () => {
  const cron = parseCron5('0 0 1 * 1');
  assert.equal(cron5Matches(cron, new Date(2026, 8, 1, 0, 0, 0)), true);
  assert.equal(cron5Matches(cron, new Date(2026, 8, 7, 0, 0, 0)), true);
  assert.equal(cron5Matches(cron, new Date(2026, 8, 2, 0, 0, 0)), false);
});

test('nextCronRunAt is strictly in the future', () => {
  const from = new Date(2026, 8, 3, 9, 30, 12);
  const next = nextCronRunAt('30 9 * * *', from);
  assert.equal(next.getFullYear(), 2026);
  assert.equal(next.getMonth(), 8);
  assert.equal(next.getDate(), 4);
  assert.equal(next.getHours(), 9);
  assert.equal(next.getMinutes(), 30);
});
