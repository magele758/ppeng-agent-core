import test from 'node:test';
import assert from 'node:assert/strict';
import {
  minifyMcpToolInputSchema,
  parseMcpSchemaMinifyLevel
} from '../dist/mcp/mcp-schema-minify.js';

test('minify level 0 clones schema', () => {
  const s = { type: 'object', $schema: 'http://json-schema.org/draft-07/schema#' };
  const out = minifyMcpToolInputSchema(s, 0);
  assert.notStrictEqual(out, s);
  assert.deepEqual(out, s);
});

test('minify level 1 removes meta keys', () => {
  const s = {
    $schema: 'x',
    title: 'T',
    type: 'object',
    properties: { a: { type: 'string', title: 'A', description: 'desc' } }
  };
  const out = minifyMcpToolInputSchema(s, 1);
  assert.equal(out.$schema, undefined);
  assert.equal(out.title, undefined);
  assert.equal(out.properties.a.title, undefined);
  assert.equal(out.properties.a.description, 'desc');
});

test('minify level 2 removes descriptions and defaults', () => {
  const s = {
    type: 'object',
    additionalProperties: false,
    properties: { q: { type: 'string', description: 'long', default: 'x' } },
    required: ['q']
  };
  const out = minifyMcpToolInputSchema(s, 2);
  assert.equal(out.additionalProperties, undefined);
  const pq = out.properties.q;
  assert.equal(pq.description, undefined);
  assert.equal(pq.default, undefined);
  assert.equal(pq.type, 'string');
  assert.deepEqual(out.required, ['q']);
});

test('parseMcpSchemaMinifyLevel defaults to 1', () => {
  const saved = process.env.RAW_AGENT_MCP_SCHEMA_MINIFY;
  delete process.env.RAW_AGENT_MCP_SCHEMA_MINIFY;
  assert.equal(parseMcpSchemaMinifyLevel(process.env), 1);
  if (saved !== undefined) process.env.RAW_AGENT_MCP_SCHEMA_MINIFY = saved;
});

test('parseMcpSchemaMinifyLevel reads 0 and 2', () => {
  process.env.RAW_AGENT_MCP_SCHEMA_MINIFY = '0';
  assert.equal(parseMcpSchemaMinifyLevel(process.env), 0);
  process.env.RAW_AGENT_MCP_SCHEMA_MINIFY = '2';
  assert.equal(parseMcpSchemaMinifyLevel(process.env), 2);
  delete process.env.RAW_AGENT_MCP_SCHEMA_MINIFY;
});
