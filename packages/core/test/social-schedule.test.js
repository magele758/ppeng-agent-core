import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SOCIAL_POST_SCHEDULE_METADATA_KEY,
  buildSocialPostSchedule,
  normalizeSocialChannels,
  readSocialPostSchedule,
  runSocialPostScheduleDelivery,
  taskTitleForSocialSchedule,
  isValidIsoInstant,
  validateNormalizedSocialChannels,
} from '../dist/social-schedule.js';

describe('social-schedule', () => {
  describe('normalizeSocialChannels', () => {
    it('trims, aliases twitter, dedupes', () => {
      assert.deepEqual(normalizeSocialChannels([' Twitter ', 'x', ' LinkedIn ']), ['x', 'linkedin']);
    });

    it('returns undefined for non-array', () => {
      assert.equal(normalizeSocialChannels(null), undefined);
      assert.equal(normalizeSocialChannels('x'), undefined);
      assert.equal(normalizeSocialChannels({}), undefined);
    });

    it('returns undefined for empty array', () => {
      assert.equal(normalizeSocialChannels([]), undefined);
    });

    it('returns undefined if any item is not a string', () => {
      assert.equal(normalizeSocialChannels(['x', 123]), undefined);
    });

    it('returns undefined if any item is empty after trim', () => {
      assert.equal(normalizeSocialChannels(['x', '  ']), undefined);
    });
  });

  describe('isValidIsoInstant', () => {
    it('rejects garbage', () => {
      assert.equal(isValidIsoInstant('not-a-date'), false);
    });
    it('rejects ambiguous or locale-shaped dates', () => {
      assert.equal(isValidIsoInstant('2026-04-18'), false);
      assert.equal(isValidIsoInstant('04/18/2026'), false);
      assert.equal(isValidIsoInstant('1'), false);
      assert.equal(isValidIsoInstant('2026-04-18T12:00:00'), false);
    });
    it('accepts Z and explicit offset instants', () => {
      assert.equal(isValidIsoInstant('2026-04-18T12:00:00.000Z'), true);
      assert.equal(isValidIsoInstant('2026-04-18T12:00:00Z'), true);
      assert.equal(isValidIsoInstant('2026-04-18T15:00:00+02:00'), true);
    });
  });

  describe('buildSocialPostSchedule', () => {
    it('rejects unknown provider labels', () => {
      const r = buildSocialPostSchedule({
        body: 'Hello',
        channels: ['linkedinn'],
        publishAt: '2026-04-18T15:00:00.000Z',
        gatewayChannelIds: new Set(),
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.ok(r.error.includes('unsupported social channel'));
    });

    it('rejects webhook id missing from gateway config', () => {
      const r = buildSocialPostSchedule({
        body: 'Hello',
        channels: ['webhook:does-not-exist'],
        publishAt: '2026-04-18T15:00:00.000Z',
        gatewayChannelIds: new Set(['other']),
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.ok(r.error.includes('not configured'));
    });

    it('accepts webhook when id is configured', () => {
      const r = buildSocialPostSchedule({
        body: 'Hello',
        channels: ['webhook:notify'],
        publishAt: '2026-04-18T15:00:00.000Z',
        gatewayChannelIds: new Set(['notify']),
      });
      assert.equal(r.ok, true);
    });

    it('returns schedule with defaults', () => {
      const r = buildSocialPostSchedule({
        body: 'Hello world',
        channels: ['linkedin'],
        publishAt: '2026-04-18T15:00:00.000Z',
      });
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal(r.schedule.approval, 'pending_approval');
        assert.equal(r.schedule.dispatch.state, 'pending');
        assert.ok(r.schedule.idempotencyKey.startsWith('soc_'));
        assert.equal(r.schedule.body, 'Hello world');
        assert.deepEqual(r.schedule.channels, ['linkedin']);
      }
    });

    it('validates required body', () => {
      assert.equal(buildSocialPostSchedule({ body: '', channels: ['x'], publishAt: '2026-01-01T00:00:00.000Z' }).ok, false);
      assert.equal(buildSocialPostSchedule({ body: '  ', channels: ['x'], publishAt: '2026-01-01T00:00:00.000Z' }).ok, false);
    });

    it('validates body length', () => {
      const longBody = 'a'.repeat(32001);
      const r = buildSocialPostSchedule({ body: longBody, channels: ['x'], publishAt: '2026-01-01T00:00:00.000Z' });
      assert.equal(r.ok, false);
      if (!r.ok) assert.ok(r.error.includes('body exceeds'));
    });

    it('validates channels', () => {
      assert.equal(buildSocialPostSchedule({ body: 'x', channels: [], publishAt: '2026-01-01T00:00:00.000Z' }).ok, false);
      assert.equal(buildSocialPostSchedule({ body: 'x', channels: 'not-array', publishAt: '2026-01-01T00:00:00.000Z' }).ok, false);
    });

    it('validates publishAt', () => {
      assert.equal(buildSocialPostSchedule({ body: 'x', channels: ['x'], publishAt: '' }).ok, false);
      assert.equal(buildSocialPostSchedule({ body: 'x', channels: ['x'], publishAt: 'invalid-date' }).ok, false);
    });

    it('rejects publishAt without explicit timezone', () => {
      assert.equal(buildSocialPostSchedule({ body: 'x', channels: ['x'], publishAt: '2026-04-18' }).ok, false);
      assert.equal(buildSocialPostSchedule({ body: 'x', channels: ['x'], publishAt: '04/18/2026' }).ok, false);
      assert.equal(buildSocialPostSchedule({ body: 'x', channels: ['x'], publishAt: '1' }).ok, false);
      assert.equal(buildSocialPostSchedule({ body: 'x', channels: ['x'], publishAt: '2026-04-18T12:00:00' }).ok, false);
    });

    it('normalizes publishAt with offset to UTC', () => {
      const r = buildSocialPostSchedule({
        body: 'x',
        channels: ['x'],
        publishAt: '2026-04-18T15:00:00+02:00',
      });
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.schedule.publishAt, '2026-04-18T13:00:00.000Z');
    });

    it('validates firstComment', () => {
      assert.equal(buildSocialPostSchedule({ body: 'x', channels: ['x'], publishAt: '2026-01-01T00:00:00.000Z', firstComment: 123 }).ok, false);
      const longComment = 'a'.repeat(8001);
      assert.equal(buildSocialPostSchedule({ body: 'x', channels: ['x'], publishAt: '2026-01-01T00:00:00.000Z', firstComment: longComment }).ok, false);
    });

    it('validates followUpHint', () => {
      assert.equal(buildSocialPostSchedule({ body: 'x', channels: ['x'], publishAt: '2026-01-01T00:00:00.000Z', followUpHint: 123 }).ok, false);
      const longHint = 'a'.repeat(4001);
      assert.equal(buildSocialPostSchedule({ body: 'x', channels: ['x'], publishAt: '2026-01-01T00:00:00.000Z', followUpHint: longHint }).ok, false);
    });

    it('respects provided approval state', () => {
      const r = buildSocialPostSchedule({
        body: 'x',
        channels: ['x'],
        publishAt: '2026-01-01T00:00:00.000Z',
        approval: 'approved'
      });
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.schedule.approval, 'approved');
    });

    it('defaults approval to pending_approval for invalid string', () => {
      const r = buildSocialPostSchedule({
        body: 'x',
        channels: ['x'],
        publishAt: '2026-01-01T00:00:00.000Z',
        approval: 'garbage'
      });
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.schedule.approval, 'pending_approval');
    });

    it('respects provided idempotencyKey', () => {
      const r = buildSocialPostSchedule({
        body: 'x',
        channels: ['x'],
        publishAt: '2026-01-01T00:00:00.000Z',
        idempotencyKey: 'custom-key'
      });
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.schedule.idempotencyKey, 'custom-key');
    });

    it('includes firstComment and followUpHint when provided', () => {
      const r = buildSocialPostSchedule({
        body: 'x',
        channels: ['x'],
        publishAt: '2026-01-01T00:00:00.000Z',
        firstComment: 'Comment',
        followUpHint: 'Hint'
      });
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal(r.schedule.firstComment, 'Comment');
        assert.equal(r.schedule.followUpHint, 'Hint');
      }
    });

    it('sets initial dispatch state to pending', () => {
      const r = buildSocialPostSchedule({
        body: 'x',
        channels: ['x'],
        publishAt: '2026-01-01T00:00:00.000Z'
      });
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal(r.schedule.dispatch.state, 'pending');
        assert.equal(r.schedule.dispatch.lastAttemptAt, undefined);
        assert.equal(r.schedule.dispatch.externalRef, undefined);
      }
    });
  });

  describe('readSocialPostSchedule', () => {
    it('reads from task metadata', () => {
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

    it('returns undefined for missing or invalid metadata', () => {
      assert.equal(readSocialPostSchedule(undefined), undefined);
      assert.equal(readSocialPostSchedule({}), undefined);
      assert.equal(readSocialPostSchedule({ [SOCIAL_POST_SCHEDULE_METADATA_KEY]: 'not-an-object' }), undefined);
      assert.equal(readSocialPostSchedule({ [SOCIAL_POST_SCHEDULE_METADATA_KEY]: { version: 2 } }), undefined);
    });
  });

  describe('validateNormalizedSocialChannels', () => {
    it('flags empty webhook id', () => {
      const v = validateNormalizedSocialChannels(['webhook:'], new Set(['a']));
      assert.equal(v.ok, false);
    });
  });

  describe('runSocialPostScheduleDelivery', () => {
    it('is idempotent after success', async () => {
      const built = buildSocialPostSchedule({
        body: 'Hi',
        channels: ['x'],
        publishAt: '2026-04-18T15:00:00.000Z',
      });
      assert.equal(built.ok, true);
      let n = 0;
      const deliver = async () => {
        n += 1;
        return { ok: true, detail: 'ok' };
      };
      const r1 = await runSocialPostScheduleDelivery(built.schedule, deliver);
      assert.equal(r1.ok, true);
      assert.equal(n, 1);
      const r2 = await runSocialPostScheduleDelivery(r1.schedule, deliver);
      assert.equal(r2.ok, true);
      assert.equal(n, 1);
    });

    it('marks aggregate as partial when some channels fail', async () => {
      const built = buildSocialPostSchedule({
        body: 'Hi',
        channels: ['x', 'linkedin'],
        publishAt: '2026-04-18T15:00:00.000Z',
      });
      assert.equal(built.ok, true);
      const deliver = async (ch) => {
        if (ch === 'x') return { ok: true, detail: 'tweet:42' };
        return { ok: false, detail: 'rate-limited' };
      };
      const r = await runSocialPostScheduleDelivery(built.schedule, deliver);
      assert.equal(r.ok, false);
      assert.equal(r.schedule.dispatch.state, 'partial');
      assert.equal(r.schedule.dispatch.channels.x.state, 'succeeded');
      assert.equal(r.schedule.dispatch.channels.x.externalRef, 'tweet:42');
      assert.equal(r.schedule.dispatch.channels.linkedin.state, 'failed');
      assert.equal(r.schedule.dispatch.channels.linkedin.lastError, 'rate-limited');
    });

    it('on retry only re-attempts non-succeeded channels', async () => {
      const built = buildSocialPostSchedule({
        body: 'Hi',
        channels: ['x', 'linkedin'],
        publishAt: '2026-04-18T15:00:00.000Z',
      });
      assert.equal(built.ok, true);
      const calls = [];
      let linkedinFailFirst = true;
      const deliver = async (ch) => {
        calls.push(ch);
        if (ch === 'x') return { ok: true, detail: 'tweet:42' };
        if (ch === 'linkedin' && linkedinFailFirst) {
          linkedinFailFirst = false;
          return { ok: false, detail: 'rate-limited' };
        }
        return { ok: true, detail: 'li:7' };
      };
      const r1 = await runSocialPostScheduleDelivery(built.schedule, deliver);
      assert.equal(r1.schedule.dispatch.state, 'partial');
      assert.deepEqual(calls, ['x', 'linkedin']);

      const r2 = await runSocialPostScheduleDelivery(r1.schedule, deliver);
      assert.equal(r2.ok, true);
      assert.equal(r2.schedule.dispatch.state, 'succeeded');
      // x already succeeded last round, so deliver was NOT called for it again
      assert.deepEqual(calls, ['x', 'linkedin', 'linkedin']);
    });

    it('lazy-upgrades legacy schedules without dispatch.channels', async () => {
      const built = buildSocialPostSchedule({
        body: 'Hi',
        channels: ['x'],
        publishAt: '2026-04-18T15:00:00.000Z',
      });
      // Simulate a record persisted before per-channel state existed.
      const legacy = {
        ...built.schedule,
        dispatch: { state: 'succeeded', lastAttemptAt: '2026-04-18T16:00:00.000Z', externalRef: 'old' },
      };
      let n = 0;
      const deliver = async () => {
        n += 1;
        return { ok: true, detail: 'ok' };
      };
      const r = await runSocialPostScheduleDelivery(legacy, deliver);
      assert.equal(r.ok, true);
      assert.equal(n, 0, 'previously-succeeded legacy schedule must not re-deliver');
      assert.equal(r.schedule.dispatch.channels.x.state, 'succeeded');
    });

    it('legacy failed aggregate marks channels as failed, not pending (prevents blind re-delivery)', async () => {
      const built = buildSocialPostSchedule({
        body: 'Hi',
        channels: ['x', 'linkedin'],
        publishAt: '2026-04-18T15:00:00.000Z',
      });
      const legacy = {
        ...built.schedule,
        dispatch: { state: 'failed', lastAttemptAt: '2026-04-18T16:00:00.000Z', lastError: 'rate-limited' },
      };
      const calls = [];
      const deliver = async (ch) => {
        calls.push(ch);
        return { ok: true, detail: 'ok' };
      };
      const r = await runSocialPostScheduleDelivery(legacy, deliver);
      // Both channels should have been re-attempted (state=failed → eligible for retry)
      assert.deepEqual(calls, ['x', 'linkedin']);
      assert.equal(r.ok, true);
      assert.equal(r.schedule.dispatch.state, 'succeeded');
      // Verify the per-channel entries carry the legacy sentinel
      // (before the retry they were 'failed' with a legacy message, now succeeded)
      assert.equal(r.schedule.dispatch.channels.x.state, 'succeeded');
      assert.equal(r.schedule.dispatch.channels.linkedin.state, 'succeeded');
    });

    it('legacy pending aggregate keeps channels pending', async () => {
      const built = buildSocialPostSchedule({
        body: 'Hi',
        channels: ['x'],
        publishAt: '2026-04-18T15:00:00.000Z',
      });
      const legacy = {
        ...built.schedule,
        dispatch: { state: 'pending' },
      };
      let n = 0;
      const deliver = async () => {
        n += 1;
        return { ok: true, detail: 'ok' };
      };
      const r = await runSocialPostScheduleDelivery(legacy, deliver);
      assert.equal(r.ok, true);
      assert.equal(n, 1);
      assert.equal(r.schedule.dispatch.channels.x.state, 'succeeded');
    });
  });

  describe('taskTitleForSocialSchedule', () => {
    it('prefixes and truncates long body', () => {
      const long = 'a'.repeat(100);
      const t = taskTitleForSocialSchedule(long);
      assert.ok(t.startsWith('[Social] '));
      assert.ok(t.includes('…'));
      assert.ok(t.length <= 72 + 10); // [Social] + snippet + ellipsis
    });

    it('does not add ellipsis for short body', () => {
      const short = 'Short post';
      const t = taskTitleForSocialSchedule(short);
      assert.equal(t, '[Social] Short post');
    });

    it('picks first non-empty line', () => {
      const body = '\n\n  First actual line  \nSecond line';
      const t = taskTitleForSocialSchedule(body);
      assert.equal(t, '[Social] First actual line');
    });
  });
});
