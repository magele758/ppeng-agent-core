import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDetailsOpen } from './seed-details-open.ts';

test('seedDetailsOpen opens once and then leaves user toggle alone', () => {
  const el = { dataset: {}, open: false } as unknown as HTMLDetailsElement;
  seedDetailsOpen(null, true);
  seedDetailsOpen(el, true);
  assert.equal(el.open, true);
  assert.equal(el.dataset.seeded, '1');
  el.open = false;
  seedDetailsOpen(el, true);
  assert.equal(el.open, false);
});
