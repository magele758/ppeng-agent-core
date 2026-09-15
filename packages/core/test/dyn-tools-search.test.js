import test from 'node:test';
import assert from 'node:assert/strict';
import { searchDynTools, selectHydrateRecords, defaultDynToolSettings } from '../dist/dyn-tools/index.js';

function rec(name, status = 'active', extra = {}) {
  return {
    name,
    description: extra.description ?? `${name} helper`,
    inputSchema: {},
    kind: 'ptc_cell',
    source: { code: 'return 1' },
    scope: 'session.scratch',
    status,
    stats: { uses: extra.uses ?? 0 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

test('15 active only inject top-k + used', () => {
  const records = [];
  for (let i = 0; i < 15; i += 1) {
    records.push(rec(`tool_${String(i).padStart(2, '0')}`, 'active', { description: i === 3 ? 'alpha parser' : 'misc' }));
  }
  records.push(rec('sticky_used', 'active', { description: 'zzzz unused words' }));
  const settings = { ...defaultDynToolSettings(), enabled: true, hydrateTopK: 3 };
  const picked = selectHydrateRecords({
    records,
    usedNames: ['sticky_used'],
    settings,
    query: 'alpha parser',
    applyShortlist: true
  });
  const names = picked.map((r) => r.name);
  assert.ok(names.includes('sticky_used'), 'used stays even if not top-k');
  assert.ok(names.includes('tool_03'), 'lexical top hit');
  assert.ok(names.length <= 4);
});

test('searchDynTools ranks name/description', () => {
  const hits = searchDynTools('invoice total', [rec('sum_invoice', 'active', { description: 'invoice total' }), rec('other', 'active', { description: 'zzz' })], 1);
  assert.equal(hits[0].name, 'sum_invoice');
});
