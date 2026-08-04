import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStateStore } from '../dist/storage.js';
import { CapabilityRegistry } from '../dist/discovery/index.js';
import { applyVerify, verifyCapability, verifySchemaBody } from '../dist/discovery/verify.js';

test('verify: openapi body hash → verified; never bound', () => {
  const dir = mkdtempSync(join(tmpdir(), 'verify-'));
  const store = new SqliteStateStore(join(dir, 'state.db'));
  const registry = new CapabilityRegistry(store.capabilities());
  const card = registry.create({
    kind: 'openapi',
    name: 'Demo',
    endpoint: 'https://api.example.com/openapi.json'
  });
  const body = JSON.stringify({ openapi: '3.0.0', paths: {} });
  const result = applyVerify(registry, card.id, verifySchemaBody(card, body));
  assert.equal(result.ok, true);
  assert.equal(result.card.trust, 'verified');
  assert.ok(result.schemaHash);

  const again = verifyCapability(registry.get(card.id), { body });
  assert.equal(again.ok, true);

  store.db.close();
  rmSync(dir, { recursive: true, force: true });
});
