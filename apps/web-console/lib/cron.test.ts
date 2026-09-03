import test from 'node:test';
import assert from 'node:assert/strict';
import { cronFromTime, describeCron, parseCronUserPrompt, parseTimeValue } from './cron.ts';

test('cronFromTime presets', () => {
  assert.equal(cronFromTime({ hour: 9, minute: 30, preset: 'daily' }), '30 9 * * *');
  assert.equal(cronFromTime({ hour: 18, minute: 0, preset: 'weekdays' }), '0 18 * * 1-5');
  assert.equal(cronFromTime({ hour: 9, minute: 0, preset: 'weekly', weekday: 1 }), '0 9 * * 1');
  assert.equal(cronFromTime({ hour: 0, minute: 15, preset: 'hourly' }), '15 * * * *');
});

test('describeCron covers common presets', () => {
  assert.equal(describeCron('30 9 * * *'), '每天 09:30');
  assert.equal(describeCron('0 18 * * 1-5'), '工作日 18:00');
  assert.equal(describeCron('15 * * * *'), '每小时的 15 分');
});

test('parseCronUserPrompt', () => {
  const parsed = parseCronUserPrompt('[cron:晨报] 总结昨日进展');
  assert.deepEqual(parsed, { name: '晨报', body: '总结昨日进展' });
  assert.equal(parseCronUserPrompt('普通消息'), null);
});

test('parseTimeValue', () => {
  assert.deepEqual(parseTimeValue('09:05'), { hour: 9, minute: 5 });
  assert.deepEqual(parseTimeValue('bad'), { hour: 9, minute: 0 });
});
