import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOpenApiSpec } from '../dist/discovery/adapters/openapi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, 'fixtures/openapi/petstore-mini.json');

test('openapi adapter: petstore mini → draft tools', () => {
  const spec = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const { capability, tools } = parseOpenApiSpec(spec);
  assert.equal(capability.kind, 'openapi');
  assert.equal(capability.trust, 'untrusted');
  assert.equal(capability.name, 'Petstore Mini');
  assert.ok(tools.length >= 3);
  assert.ok(tools.some((t) => t.toolName === 'listPets'));
  assert.ok(tools.every((t) => t.schemaHash && t.schemaHash.length === 64));
});
