import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStateStore } from '../dist/storage.js';
import {
  readDiscoverySettings,
  writeDiscoverySettings,
  resolveDiscoveryEnabled,
  resolveTailscaleDiscoveryEnabled,
  hasPersistedDiscoverySettings
} from '../dist/discovery/settings.js';

test('discovery settings: UI persistence wins over env', () => {
  const dir = mkdtempSync(join(tmpdir(), 'discovery-settings-'));
  const store = new SqliteStateStore(join(dir, 'state.db'));

  assert.equal(hasPersistedDiscoverySettings(store), false);
  // No UI row → env fallback
  assert.equal(resolveDiscoveryEnabled(store, { RAW_AGENT_DISCOVERY: '1' }), true);
  assert.equal(resolveDiscoveryEnabled(store, { RAW_AGENT_DISCOVERY: '0' }), false);

  writeDiscoverySettings(store, { enabled: true, tailscaleEnabled: true });
  assert.equal(hasPersistedDiscoverySettings(store), true);
  // Persisted off would win; here on wins even if env says 0
  assert.equal(resolveDiscoveryEnabled(store, { RAW_AGENT_DISCOVERY: '0' }), true);
  assert.equal(
    resolveTailscaleDiscoveryEnabled(store, {
      RAW_AGENT_DISCOVERY: '0',
      RAW_AGENT_TAILSCALE_DISCOVERY: '0'
    }),
    true
  );

  writeDiscoverySettings(store, { enabled: false, tailscaleEnabled: true });
  assert.equal(resolveDiscoveryEnabled(store, { RAW_AGENT_DISCOVERY: '1' }), false);
  assert.equal(
    resolveTailscaleDiscoveryEnabled(store, { RAW_AGENT_DISCOVERY: '1', RAW_AGENT_TAILSCALE_DISCOVERY: '1' }),
    false
  );

  const s = readDiscoverySettings(store);
  assert.equal(s.enabled, false);
  assert.equal(s.tailscaleEnabled, true);

  store.db.close();
  rmSync(dir, { recursive: true, force: true });
});
