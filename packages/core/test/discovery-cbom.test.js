import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStateStore } from '../dist/storage.js';
import { CapabilityRegistry } from '../dist/discovery/index.js';
import {
  computeSchemaHash,
  checkSchemaPin,
  assertPinOrThrow,
  checkToolBindingPin,
  markBindingNeedsReverify
} from '../dist/discovery/cbom.js';

test('cbom: stable hash; pin mismatch throws / check fails', () => {
  const a = computeSchemaHash({ name: 'listPets', params: { limit: { type: 'integer' } } });
  const b = computeSchemaHash({ name: 'listPets', params: { limit: { type: 'integer' } } });
  assert.equal(a, b);
  const tampered = { name: 'listPets', params: { limit: { type: 'string' } } };
  const check = checkSchemaPin(a, tampered);
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'schema_pin_mismatch');
  assert.throws(() => assertPinOrThrow(a, tampered), /pin failed/);
  assert.doesNotThrow(() =>
    assertPinOrThrow(a, { name: 'listPets', params: { limit: { type: 'integer' } } })
  );
});

test('cbom: bound tool pin drift detected via store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cbom-'));
  const store = new SqliteStateStore(join(dir, 'state.db'));
  const registry = new CapabilityRegistry(store.capabilities());
  const schema = { op: 'listPets', v: 1 };
  const hash = computeSchemaHash(schema);
  const card = registry.create({
    kind: 'openapi',
    name: 'Petstore',
    endpoint: 'https://petstore.example.com',
    trust: 'verified',
    schemaHash: hash
  });
  registry.bind(card.id, {
    approved: true,
    bindings: [{ toolName: 'listPets', schemaHashPin: hash }]
  });

  const ok = checkToolBindingPin(store.capabilities(), 'listPets', schema);
  assert.equal(ok.ok, true);

  const bad = checkToolBindingPin(store.capabilities(), 'listPets', { op: 'listPets', v: 2 });
  assert.equal(bad.ok, false);
  assert.ok(bad.bindingId);
  markBindingNeedsReverify(store.capabilities(), bad.bindingId);
  const bindings = registry.listBindings(card.id);
  assert.equal(bindings[0].status, 'needs-reverify');

  // unbound tool name → allow
  assert.equal(checkToolBindingPin(store.capabilities(), 'unrelated_tool', {}).ok, true);

  store.db.close();
  rmSync(dir, { recursive: true, force: true });
});
