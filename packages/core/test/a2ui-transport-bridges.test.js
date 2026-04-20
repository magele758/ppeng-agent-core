import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  A2UI_MIME_TYPE,
  BASIC_CATALOG_ID,
  toA2aMessageParts,
  toMcpEmbeddedResource
} from '../dist/a2ui/index.js';

const messages = [
  { version: 'v0.9', createSurface: { surfaceId: 'demo', catalogId: BASIC_CATALOG_ID } },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: 'demo',
      components: [{ id: 'root', component: 'Text', text: 'hi' }]
    }
  }
];

test('toMcpEmbeddedResource: shapes a CallToolResult content entry', () => {
  const res = toMcpEmbeddedResource('demo-card', messages, { audience: ['user'] });
  assert.equal(res.type, 'resource');
  assert.equal(res.resource.uri, 'a2ui://demo-card');
  assert.equal(res.resource.mimeType, A2UI_MIME_TYPE);
  assert.deepEqual(JSON.parse(res.resource.text), messages);
  assert.deepEqual(res.annotations, { audience: ['user'] });
});

test('toMcpEmbeddedResource: sanitizes the URI suffix', () => {
  const res = toMcpEmbeddedResource('demo card with spaces / weird !@#', messages);
  assert.equal(res.resource.uri, 'a2ui://demo-card-with-spaces---weird----');
});

test('toA2aMessageParts: one Part per envelope', () => {
  const parts = toA2aMessageParts(messages);
  assert.equal(parts.length, messages.length);
  assert.equal(parts[0].kind, 'data');
  assert.equal(parts[0].data.createSurface.surfaceId, 'demo');
});
