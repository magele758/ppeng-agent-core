import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SOCIAL_POST_SCHEDULE_METADATA_KEY,
  buildSocialPostSchedule,
  normalizeSocialChannels,
  readSocialPostSchedule,
  taskTitleForSocialSchedule,
  isValidIsoInstant,
} from '../dist/social-schedule.js';

describe('social-schedule', () => {
  it('normalizeSocialChannels trims, aliases twitter, dedupes', () => {
    assert.deepEqual(normalizeSocialChannels([' Twitter ', 'x', ' LinkedIn ']), ['x', 'linkedin']);
  });

  it('isValidIsoInstant rejects garbage', () => {
    assert.equal(isValidIsoInstant('not-a-date'), false);
    assert.equal(isValidIsoInstant('2026-04-18T12:00:00.000Z'), true);
  });

  it('buildSocialPostSchedule returns schedule with defaults', () => {
    const r = buildSocialPostSchedule({
      body: 'Hello world',
      channels: ['linkedin'],
      publishAt: '2026-04-18T15:00:00.000Z',
    });
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.schedule.approval, 'pending_approval');
    assert.equal(r.ok && r.schedule.dispatch.state, 'pending');
    assert.ok(r.ok && r.schedule.idempotencyKey.startsWith('soc_'));
  });

  it('buildSocialPostSchedule validates', () => {
    assert.equal(
      buildSocialPostSchedule({ body: '', channels: ['x'], publishAt: '2026-01-01T00:00:00.000Z' }).ok,
      false,
    );
    assert.equal(
      buildSocialPostSchedule({ body: 'x', channels: [], publishAt: '2026-01-01T00:00:00.000Z' }).ok,
      false,
    );
  });

  it('readSocialPostSchedule reads from task metadata', () => {
    const built = buildSocialPostSchedule({
      body: 'Post',
      channels: ['x'],
      publishAt: '2026-05-01T10:00:00.000Z',
      idempotencyKey: 'fixed-key',
    });
    assert.equal(built.ok, true);
    const schedule = built.ok ? built.schedule : null;
    const meta = { [SOCIAL_POST_SCHEDULE_METADATA_KEY]: schedule };
    const read = readSocialPostSchedule(meta);
    assert.equal(read?.idempotencyKey, 'fixed-key');
  });

  it('taskTitleForSocialSchedule prefixes and truncates', () => {
    const long = 'a'.repeat(100);
    const t = taskTitleForSocialSchedule(long);
    assert.ok(t.startsWith('[Social] '));
    assert.ok(t.includes('…'));
  });
});
