import test from 'node:test';
import assert from 'node:assert/strict';
import { annotateRetiredToolParts, retiredMarker } from '../dist/dyn-tools/index.js';

function msg(role, parts) {
  return {
    id: `m-${role}`,
    sessionId: 's1',
    role,
    parts,
    createdAt: new Date().toISOString()
  };
}

test('retired names appear in model view, stored parts stay unmarked', () => {
  const stored = [
    msg('assistant', [{ type: 'tool_call', toolCallId: 'c1', name: 'old_fn', input: {} }]),
    msg('tool', [{ type: 'tool_result', toolCallId: 'c1', name: 'old_fn', ok: true, content: 'ok-body' }])
  ];
  const view = annotateRetiredToolParts(stored, new Set(['old_fn']));
  assert.ok(view[0].parts.some((p) => p.type === 'text' && p.text === retiredMarker('old_fn')));
  assert.ok(view[1].parts[0].content.startsWith(retiredMarker('old_fn')));
  assert.equal(stored[0].parts.length, 1);
  assert.equal(stored[1].parts[0].content, 'ok-body');
  assert.ok(!JSON.stringify(stored).includes('retired:'));
});

test('non-retired names are unchanged', () => {
  const stored = [
    msg('assistant', [{ type: 'tool_call', toolCallId: 'c1', name: 'live_fn', input: {} }])
  ];
  const view = annotateRetiredToolParts(stored, new Set(['other']));
  assert.deepEqual(view[0].parts, stored[0].parts);
});
