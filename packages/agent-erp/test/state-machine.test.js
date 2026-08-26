/**
 * Pure state-machine unit tests for ERP document lifecycle.
 * Reject path must never create a ledger entry; approve→post must.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDraft,
  submitDocument,
  postDocument,
  rejectDocument,
  hasLedgerImpact,
  isPosted,
} from '../dist/state-machine.js';

test('createDraft → status=draft, no ledger', () => {
  const r = createDraft({ id: 'd1', docType: 'invoice', payload: { amount: 100, currency: 'CNY' } });
  assert.equal(r.ok, true);
  assert.equal(r.value.status, 'draft');
  assert.equal(r.value.ledgerEntryId, undefined);
  assert.equal(hasLedgerImpact(r.value), false);
});

test('draft → reject：不落账', () => {
  const d = createDraft({ id: 'd2', payload: { amount: 50 } });
  assert.equal(d.ok, true);
  const rejected = rejectDocument(d.value, { reason: 'user denied' });
  assert.equal(rejected.ok, true);
  assert.equal(rejected.value.status, 'void');
  assert.equal(rejected.value.ledgerEntryId, undefined);
  assert.equal(hasLedgerImpact(rejected.value), false);
  assert.ok(rejected.value.audit.some((e) => e.action === 'reject'));
});

test('draft → submit → reject：不落账', () => {
  let doc = createDraft({ id: 'd3', payload: { amount: 80 } }).value;
  doc = submitDocument(doc).value;
  assert.equal(doc.status, 'submitted');
  const rejected = rejectDocument(doc, { reason: 'approver rejected' });
  assert.equal(rejected.ok, true);
  assert.equal(rejected.value.status, 'void');
  assert.equal(hasLedgerImpact(rejected.value), false);
});

test('approve 路径：draft → submit → post 落账', () => {
  let doc = createDraft({
    id: 'd4',
    docType: 'journal',
    payload: { amount: 200, currency: 'USD', memo: 'test post' },
  }).value;
  doc = submitDocument(doc).value;
  const posted = postDocument(doc, { idempotencyKey: 'idem-1', ledgerEntryId: 'led-fixed' });
  assert.equal(posted.ok, true);
  assert.equal(posted.value.document.status, 'posted');
  assert.equal(posted.value.document.ledgerEntryId, 'led-fixed');
  assert.equal(isPosted(posted.value.document), true);
  assert.equal(hasLedgerImpact(posted.value.document), true);
  assert.ok(posted.value.ledger);
  assert.equal(posted.value.ledger.id, 'led-fixed');
  assert.equal(posted.value.ledger.amount, 200);
  assert.equal(posted.value.ledger.currency, 'USD');
});

test('cannot post from draft (需先 submit)', () => {
  const doc = createDraft({ id: 'd5', payload: { amount: 1 } }).value;
  const r = postDocument(doc);
  assert.equal(r.ok, false);
  assert.match(r.error, /submitted/);
});

test('cannot reject posted document', () => {
  let doc = createDraft({ id: 'd6', payload: { amount: 1 } }).value;
  doc = submitDocument(doc).value;
  doc = postDocument(doc).value.document;
  const r = rejectDocument(doc);
  assert.equal(r.ok, false);
});

test('post idempotency：同 key 重放不二次落账', () => {
  let doc = createDraft({ id: 'd7', payload: { amount: 9 } }).value;
  doc = submitDocument(doc).value;
  const first = postDocument(doc, { idempotencyKey: 'k', ledgerEntryId: 'L1' });
  assert.equal(first.ok, true);
  assert.ok(first.value.ledger);
  const second = postDocument(first.value.document, { idempotencyKey: 'k' });
  assert.equal(second.ok, true);
  assert.equal(second.value.ledger, null);
  assert.equal(second.value.document.ledgerEntryId, 'L1');
});
