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
import { AGENT_LOOP_SETTINGS_KEY, resolveSteerDrainPolicy } from '../dist/session/steer-drain.js';
import {
  defaultLoopSettings,
  hasPersistedLoopSettings,
  LOOP_SETTINGS_KEY,
  loopSettingsAsRuntimeHint,
  parseSteerDrainPolicy,
  readLoopSettings,
  writeLoopSettings
} from '../../../apps/daemon/dist/loop-settings.js';
import { steerHttpFromCoreAck } from '../../../apps/daemon/dist/steer-ack.js';

test('loop settings default is next_shot_only and persist in daemon_control KV', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loop-settings-'));
  const store = new SqliteStateStore(join(dir, 'state.db'));

  assert.equal(LOOP_SETTINGS_KEY, AGENT_LOOP_SETTINGS_KEY);
  assert.equal(hasPersistedLoopSettings(store), false);
  assert.equal(readLoopSettings(store).steerDrainPolicy, 'next_shot_only');
  assert.equal(defaultLoopSettings().steerDrainPolicy, 'next_shot_only');
  assert.equal(parseSteerDrainPolicy('nope'), undefined);
  assert.equal(parseSteerDrainPolicy('tool_launch'), 'tool_launch');
  assert.equal(resolveSteerDrainPolicy({ store }), 'next_shot_only');

  const saved = writeLoopSettings(store, { steerDrainPolicy: 'tool_launch' });
  assert.equal(hasPersistedLoopSettings(store), true);
  assert.equal(saved.steerDrainPolicy, 'tool_launch');
  assert.equal(readLoopSettings(store).steerDrainPolicy, 'tool_launch');
  assert.deepEqual(loopSettingsAsRuntimeHint(saved), { steerDrainPolicy: 'tool_launch' });
  assert.equal(store.getDaemonControl(AGENT_LOOP_SETTINGS_KEY).steerDrainPolicy, 'tool_launch');
  assert.equal(resolveSteerDrainPolicy({ store }), 'tool_launch');

  writeLoopSettings(store, { steerDrainPolicy: 'next_shot_only' });
  assert.equal(readLoopSettings(store).steerDrainPolicy, 'next_shot_only');
  assert.equal(resolveSteerDrainPolicy({ store }), 'next_shot_only');

  store.db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('steer HTTP ack maps core SteerAck onto {ok, steered|not_submitted}', () => {
  const item = { id: 'item' };
  const steered = steerHttpFromCoreAck(
    { status: 'steered', item },
    { id: 's1', status: 'running' }
  );
  assert.equal(steered.ok, true);
  assert.equal(steered.status, 'steered');
  assert.equal(steered.item.id, 'item');

  const started = steerHttpFromCoreAck(
    { status: 'started', item },
    { id: 's1', status: 'idle' }
  );
  assert.equal(started.ok, true);
  assert.equal(started.status, 'steered');
  assert.equal(started.item.id, 'item');

  const missing = steerHttpFromCoreAck({ status: 'not_submitted', reason: 'no_session' });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 'not_submitted');
  assert.equal(missing.reason, 'no_session');

  const ended = steerHttpFromCoreAck(
    { status: 'not_submitted', reason: 'session_ended' },
    { id: 's1', status: 'completed' }
  );
  assert.equal(ended.ok, false);
  assert.equal(ended.status, 'not_submitted');
  assert.equal(ended.session.id, 's1');
});
