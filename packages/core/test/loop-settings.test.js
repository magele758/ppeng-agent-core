/**
 * Daemon-owned loop settings + steer HTTP mapping (Phase 4 host).
 * Lives in core/test so it runs with `npm run test:unit` after daemon tsc.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStateStore } from '../dist/storage.js';
import {
  defaultLoopSettings,
  hasPersistedLoopSettings,
  loopSettingsAsRuntimeHint,
  parseSteerDrainPolicy,
  readLoopSettings,
  writeLoopSettings
} from '../../../apps/daemon/dist/loop-settings.js';
import {
  notSubmittedAck,
  sessionAcceptsSteer,
  steeredAck
} from '../../../apps/daemon/dist/steer-ack.js';

test('loop settings default is next_shot_only and persist in daemon_control KV', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loop-settings-'));
  const store = new SqliteStateStore(join(dir, 'state.db'));

  assert.equal(hasPersistedLoopSettings(store), false);
  assert.equal(readLoopSettings(store).steerDrainPolicy, 'next_shot_only');
  assert.equal(defaultLoopSettings().steerDrainPolicy, 'next_shot_only');
  assert.equal(parseSteerDrainPolicy('nope'), undefined);
  assert.equal(parseSteerDrainPolicy('tool_launch'), 'tool_launch');

  const saved = writeLoopSettings(store, { steerDrainPolicy: 'tool_launch' });
  assert.equal(hasPersistedLoopSettings(store), true);
  assert.equal(saved.steerDrainPolicy, 'tool_launch');
  assert.equal(readLoopSettings(store).steerDrainPolicy, 'tool_launch');
  assert.deepEqual(loopSettingsAsRuntimeHint(saved), { steerDrainPolicy: 'tool_launch' });

  writeLoopSettings(store, { steerDrainPolicy: 'next_shot_only' });
  assert.equal(readLoopSettings(store).steerDrainPolicy, 'next_shot_only');

  store.db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('steer HTTP ack: missing/ended => not_submitted; idle/running => steered', () => {
  assert.deepEqual(sessionAcceptsSteer(undefined), { accept: false, reason: 'no_session' });
  assert.deepEqual(sessionAcceptsSteer({ id: 's1', status: 'completed' }), {
    accept: false,
    reason: 'session_ended'
  });
  assert.deepEqual(sessionAcceptsSteer({ id: 's1', status: 'failed' }), {
    accept: false,
    reason: 'session_ended'
  });
  assert.deepEqual(sessionAcceptsSteer({ id: 's1', status: 'idle' }), {
    accept: true,
    session: { id: 's1', status: 'idle' }
  });
  assert.deepEqual(sessionAcceptsSteer({ id: 's1', status: 'running' }), {
    accept: true,
    session: { id: 's1', status: 'running' }
  });
  assert.deepEqual(sessionAcceptsSteer({ id: 's1', status: 'waiting_approval' }), {
    accept: true,
    session: { id: 's1', status: 'waiting_approval' }
  });

  const steered = steeredAck({ id: 'item' }, { id: 's1', status: 'running' });
  assert.equal(steered.ok, true);
  assert.equal(steered.status, 'steered');
  assert.equal(steered.item.id, 'item');

  const missing = notSubmittedAck('no_session');
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 'not_submitted');
  assert.equal(missing.reason, 'no_session');
});
