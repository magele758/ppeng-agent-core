import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStateStore } from '../dist/storage.js';
import { CapabilityRegistry, assertTrustTransition } from '../dist/discovery/index.js';
import {
  evaluateProbeTarget,
  hostInCidr,
  probePolicyFromEnv,
  isTailscaleIp
} from '../dist/discovery/probe-policy.js';
import { getCurrentSchemaVersion, LATEST_SCHEMA_VERSION } from '../dist/stores/migrations/index.js';

function tmpStore() {
  const dir = mkdtempSync(join(tmpdir(), 'cap-reg-'));
  const store = new SqliteStateStore(join(dir, 'state.db'));
  return { dir, store, registry: new CapabilityRegistry(store.capabilities()) };
}

test('migration v11: capabilities tables exist; schema at latest', () => {
  const { dir, store } = tmpStore();
  try {
    assert.equal(getCurrentSchemaVersion(store.db), LATEST_SCHEMA_VERSION);
    assert.ok(LATEST_SCHEMA_VERSION >= 11);
    const cols = store.db.prepare(`PRAGMA table_info(capabilities)`).all();
    assert.ok(cols.some((c) => c.name === 'trust'));
    assert.ok(cols.some((c) => c.name === 'pool'));
    const bcols = store.db.prepare(`PRAGMA table_info(capability_bindings)`).all();
    assert.ok(bcols.some((c) => c.name === 'schema_hash_pin'));
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('registry: create 3 cards; filter by trust/kind; illegal transitions', () => {
  const { dir, store, registry } = tmpStore();
  try {
    const a = registry.create({
      kind: 'openapi',
      name: 'Orders API',
      endpoint: 'https://api.example.com/openapi.json',
      source: 'manual'
    });
    const b = registry.create({
      kind: 'mcp',
      name: 'Docs MCP',
      endpoint: 'stdio://docs-mcp',
      transport: 'mcp',
      trust: 'verified'
    });
    const c = registry.create({
      kind: 'tailscale-node',
      name: 'nas-01',
      endpoint: '100.64.0.10',
      transport: 'tailscale',
      pool: 'tailnet:home',
      tags: ['tag:server']
    });
    assert.equal(a.trust, 'untrusted');
    assert.equal(b.trust, 'verified');
    assert.equal(c.kind, 'tailscale-node');

    assert.equal(registry.list({ kind: 'openapi' }).length, 1);
    assert.equal(registry.list({ trust: 'verified' }).length, 1);
    assert.equal(registry.list({ pool: 'tailnet:home' }).length, 1);

    assert.throws(() => assertTrustTransition('bound', 'verified'), /Illegal/);
    assert.throws(() => assertTrustTransition('revoked', 'untrusted'), /Illegal/);
    assert.throws(
      () =>
        registry.create({
          kind: 'http',
          name: 'x',
          endpoint: 'http://x',
          trust: 'bound'
        }),
      /bound/
    );

    assert.throws(() => registry.transitionTrust(a.id, 'bound'), /bind/);
    assert.throws(() => registry.bind(a.id, { approved: false }), /approved/);

    const bound = registry.bind(b.id, {
      approved: true,
      bindings: [{ toolName: 'docs_search', schemaHashPin: 'abc123' }]
    });
    assert.equal(bound.card.trust, 'bound');
    assert.equal(bound.bindings.length, 1);
    assert.equal(registry.listBoundCards().length, 1);

    const revoked = registry.revoke(bound.card.id);
    assert.equal(revoked.trust, 'revoked');
    assert.throws(() => registry.bind(revoked.id, { approved: true }), /revoked/);
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('probe-policy: allowlist / CIDR / tailscale CGNAT', () => {
  assert.equal(hostInCidr('10.0.0.5', '10.0.0.0/8'), true);
  assert.equal(hostInCidr('11.0.0.1', '10.0.0.0/8'), false);
  assert.equal(isTailscaleIp('100.64.1.2'), true);
  assert.equal(isTailscaleIp('8.8.8.8'), false);

  const policy = probePolicyFromEnv({
    RAW_AGENT_DISCOVERY_ACTIVE_SCAN: '0',
    RAW_AGENT_DISCOVERY_HOST_ALLOWLIST: 'api.example.com',
    RAW_AGENT_DISCOVERY_CIDR_ALLOWLIST: '10.0.0.0/8'
  });
  assert.equal(evaluateProbeTarget(policy, { host: 'api.example.com' }).allowed, true);
  assert.equal(evaluateProbeTarget(policy, { host: '10.1.2.3' }).allowed, true);
  assert.equal(evaluateProbeTarget(policy, { host: 'evil.example.org' }).allowed, false);
  assert.equal(
    evaluateProbeTarget(policy, { host: 'api.example.com', port: 22 }).allowed,
    false
  );

  const empty = probePolicyFromEnv({ RAW_AGENT_DISCOVERY_ACTIVE_SCAN: '0' });
  assert.equal(evaluateProbeTarget(empty, { host: 'anything' }).allowed, false);
});
