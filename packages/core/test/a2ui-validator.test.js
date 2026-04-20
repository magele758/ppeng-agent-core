import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AGENT_NATIVE_CATALOG_ID,
  BASIC_CATALOG_ID,
  A2uiValidationError,
  validateA2uiStream
} from '../dist/a2ui/index.js';

const v = (envelope) => ({ version: 'v0.9', ...envelope });

test('validateA2uiStream: accepts a minimal createSurface + root component', () => {
  const messages = [
    v({ createSurface: { surfaceId: 'demo', catalogId: BASIC_CATALOG_ID } }),
    v({
      updateComponents: {
        surfaceId: 'demo',
        components: [{ id: 'root', component: 'Text', text: 'hello' }]
      }
    })
  ];
  const result = validateA2uiStream(messages);
  const surface = result.surfaces.get('demo');
  assert.ok(surface, 'surface should be present');
  assert.equal(surface.catalogId, BASIC_CATALOG_ID);
  assert.equal(surface.hasRoot, true);
});

test('validateA2uiStream: orphan updates warn by default (allowOrphanUpdates=true)', () => {
  const messages = [
    v({
      updateComponents: {
        surfaceId: 'orphan',
        components: [{ id: 'root', component: 'Text', text: 'x' }]
      }
    })
  ];
  const r = validateA2uiStream(messages);
  assert.ok(r.warnings.some((w) => w.includes('not yet created')), 'should warn about orphan update');
  // synthetic surface entry is created so subsequent updates can reference it
  assert.ok(r.surfaces.has('orphan'));
});

test('validateA2uiStream: rejects orphan updates when allowOrphanUpdates=false', () => {
  const messages = [
    v({
      updateComponents: {
        surfaceId: 'orphan',
        components: [{ id: 'root', component: 'Text', text: 'x' }]
      }
    })
  ];
  assert.throws(() => validateA2uiStream(messages, { allowOrphanUpdates: false }), A2uiValidationError);
});

test('validateA2uiStream: rejects unknown catalogId', () => {
  const messages = [
    v({ createSurface: { surfaceId: 's', catalogId: 'https://example.test/unknown' } })
  ];
  assert.throws(() => validateA2uiStream(messages), A2uiValidationError);
});

test('validateA2uiStream: warns (not throws) on unknown component name', () => {
  const messages = [
    v({ createSurface: { surfaceId: 's', catalogId: BASIC_CATALOG_ID } }),
    v({
      updateComponents: {
        surfaceId: 's',
        components: [{ id: 'root', component: 'TotallyMadeUp' }]
      }
    })
  ];
  const result = validateA2uiStream(messages);
  assert.ok(result.warnings.some((w) => w.includes('TotallyMadeUp')), 'should warn about unknown component');
});

test('validateA2uiStream: agent-native catalog supports TaskCard out of the box', () => {
  const messages = [
    v({ createSurface: { surfaceId: 'task', catalogId: AGENT_NATIVE_CATALOG_ID } }),
    v({
      updateComponents: {
        surfaceId: 'task',
        components: [{ id: 'root', component: 'TaskCard', taskId: 't_1' }]
      }
    })
  ];
  const result = validateA2uiStream(messages);
  assert.equal(result.warnings.length, 0);
});

test('validateA2uiStream: deleteSurface removes surface from state', () => {
  const messages = [
    v({ createSurface: { surfaceId: 'd', catalogId: BASIC_CATALOG_ID } }),
    v({ deleteSurface: { surfaceId: 'd' } })
  ];
  const result = validateA2uiStream(messages);
  assert.ok(!result.surfaces.has('d'));
});

test('validateA2uiStream: forward child refs only emit warnings', () => {
  const messages = [
    v({ createSurface: { surfaceId: 'fwd', catalogId: BASIC_CATALOG_ID } }),
    v({
      updateComponents: {
        surfaceId: 'fwd',
        components: [
          { id: 'root', component: 'Column', children: ['notyet'] }
        ]
      }
    })
  ];
  const result = validateA2uiStream(messages);
  assert.ok(result.warnings.some((w) => w.includes('notyet')));
  assert.ok(result.surfaces.get('fwd'));
});

test('validateA2uiStream: rejects bogus envelope shape', () => {
  assert.throws(
    () => validateA2uiStream([{ version: 'v0.9' }]),
    /exactly one envelope key/
  );
  assert.throws(
    () => validateA2uiStream([{ version: 'v0.8', createSurface: { surfaceId: 'x', catalogId: BASIC_CATALOG_ID } }]),
    /unsupported version/
  );
});
