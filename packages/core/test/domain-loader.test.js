/**
 * Test the daemon's domain loader contract via the env-driven entry point.
 * Lives in core/test so it runs with the rest of the unit suite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { availableDomainIds, loadDomainBundles } from '../../../apps/daemon/dist/domain-loader.js';

test('availableDomainIds includes sre + stock', () => {
  const ids = availableDomainIds().sort();
  assert.deepEqual(ids, ['sre', 'stock']);
});

test('loadDomainBundles: empty env yields empty merged result', () => {
  const r = loadDomainBundles({ RAW_AGENT_DOMAINS: '' });
  assert.deepEqual(r.ids, []);
  assert.deepEqual(r.merged.agents, []);
  assert.deepEqual(r.merged.tools, []);
});

test('loadDomainBundles: RAW_AGENT_DOMAINS=sre mounts sre bundle', () => {
  const r = loadDomainBundles({ RAW_AGENT_DOMAINS: 'sre' });
  assert.deepEqual(r.ids, ['sre']);
  assert.ok(r.merged.agents.find((a) => a.id === 'sre-oncall'));
  assert.ok(r.merged.tools.find((t) => t.name === 'prom_query'));
});

test('loadDomainBundles: csv with whitespace + dedupe', () => {
  const r = loadDomainBundles({ RAW_AGENT_DOMAINS: ' sre , stock , sre ' });
  assert.deepEqual(r.ids, ['sre', 'stock']);
  // sre + stock together → 4 personas (2 + 2)
  assert.equal(r.merged.agents.length, 4);
});

test('loadDomainBundles: unknown ids are reported but not fatal', () => {
  const r = loadDomainBundles({ RAW_AGENT_DOMAINS: 'sre,nope,stock' });
  assert.deepEqual(r.ids, ['sre', 'stock']);
  assert.deepEqual(r.unknown, ['nope']);
});

test('loadDomainBundles: stamps domainId on agents', () => {
  const r = loadDomainBundles({ RAW_AGENT_DOMAINS: 'sre,stock' });
  assert.equal(r.merged.agents.find((a) => a.id === 'sre-oncall').domainId, 'sre');
  assert.equal(r.merged.agents.find((a) => a.id === 'stock-analyst').domainId, 'stock');
});
