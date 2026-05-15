import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderConfigFromEnv, defaultTenantIdFromEnv, validateProviderConfig } from '../dist/storage/provider-config.js';

test('createProviderConfigFromEnv: empty env → all local defaults', () => {
  const cfg = createProviderConfigFromEnv({});
  assert.equal(cfg.deploymentMode, 'local');
  assert.equal(cfg.sessionStore, 'sqlite');
  assert.equal(cfg.eventBuffer, 'local');
  assert.equal(cfg.skillRegistry, 'local_fs');
  assert.equal(cfg.assetStorage, 'local');
  assert.equal(cfg.dispatchLock, 'local');
});

test('validateProviderConfig: local defaults require nothing', () => {
  const cfg = createProviderConfigFromEnv({});
  assert.deepEqual(validateProviderConfig(cfg, {}), []);
});

test('validateProviderConfig: redis_postgres requires DATABASE_URL', () => {
  const cfg = createProviderConfigFromEnv({
    RAW_AGENT_EVENT_BUFFER_PROVIDER: 'redis_postgres',
  });
  const m = validateProviderConfig(cfg, {});
  assert.ok(m.includes('DATABASE_URL'));
});

test('defaultTenantIdFromEnv', () => {
  assert.equal(defaultTenantIdFromEnv({}), 'default');
  assert.equal(defaultTenantIdFromEnv({ RAW_AGENT_DEFAULT_TENANT_ID: 't1' }), 't1');
});
