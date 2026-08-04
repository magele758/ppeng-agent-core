/**
 * ERP tool contract + store smoke tests (in-memory mock, no disk).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  erpBundle,
  erpDraftTool,
  erpSubmitTool,
  erpPostTool,
  erpGetTool,
  resetDefaultStore,
  ErpStore,
} from '../dist/index.js';

const ctx = {
  repoRoot: '/tmp',
  stateDir: '/tmp/erp-test-no-persist',
  agent: { id: 'erp-clerk' },
  session: { id: 's1' },
};

function freshStore() {
  // persist:false — keep tests hermetic
  return resetDefaultStore(new ErpStore({ persist: false }));
}

test('erpBundle id/agents/tools/approval modes', () => {
  assert.equal(erpBundle.id, 'erp');
  assert.deepEqual(
    erpBundle.agents.map((a) => a.id),
    ['erp-clerk']
  );
  assert.deepEqual(
    erpBundle.tools.map((t) => t.name).sort(),
    ['erp_draft', 'erp_get', 'erp_post', 'erp_submit']
  );
  const byName = Object.fromEntries(erpBundle.tools.map((t) => [t.name, t]));
  assert.equal(byName.erp_draft.approvalMode, 'never');
  assert.equal(byName.erp_get.approvalMode, 'never');
  assert.equal(byName.erp_submit.approvalMode, 'always');
  assert.equal(byName.erp_post.approvalMode, 'always');
  assert.ok(erpBundle.agents[0].allowedTools.includes('erp_post'));
});

test('tools: draft → submit → post → get (approve path)', async () => {
  freshStore();
  const drafted = await erpDraftTool.execute(ctx, {
    id: 'inv-1',
    doc_type: 'invoice',
    amount: 1200,
    currency: 'CNY',
    memo: 'PO-42',
  });
  assert.equal(drafted.ok, true);
  const draftDoc = JSON.parse(drafted.content).document;
  assert.equal(draftDoc.status, 'draft');

  const submitted = await erpSubmitTool.execute(ctx, { document_id: 'inv-1' });
  assert.equal(submitted.ok, true);
  assert.equal(JSON.parse(submitted.content).document.status, 'submitted');

  const badConfirm = await erpPostTool.execute(ctx, {
    document_id: 'inv-1',
    confirm: 'yes',
  });
  assert.equal(badConfirm.ok, false);

  const posted = await erpPostTool.execute(ctx, {
    document_id: 'inv-1',
    confirm: 'CONFIRM_POST',
    idempotency_key: 'po-42-once',
  });
  assert.equal(posted.ok, true);
  const postBody = JSON.parse(posted.content);
  assert.equal(postBody.document.status, 'posted');
  assert.ok(postBody.ledger);
  assert.equal(postBody.ledger.amount, 1200);

  const got = await erpGetTool.execute(ctx, { document_id: 'inv-1' });
  assert.equal(got.ok, true);
  const body = JSON.parse(got.content);
  assert.equal(body.document.status, 'posted');
  assert.ok(body.ledger);
});

test('tools: draft then reject via state (no ledger in store)', async () => {
  const store = freshStore();
  await erpDraftTool.execute(ctx, { id: 'rej-1', amount: 10 });
  // Simulate human rejecting approval before/after submit: void via store + machine
  const { rejectDocument } = await import('../dist/state-machine.js');
  const doc = store.get('rej-1');
  const voided = rejectDocument(doc, { reason: 'denied' });
  store.put(voided.value);
  assert.equal(store.listLedger().length, 0);
  assert.equal(voided.value.ledgerEntryId, undefined);

  // post must fail on void
  const post = await erpPostTool.execute(ctx, {
    document_id: 'rej-1',
    confirm: 'CONFIRM_POST',
  });
  assert.equal(post.ok, false);
});

test('tools: cannot post without submit', async () => {
  freshStore();
  await erpDraftTool.execute(ctx, { id: 'nosub-1', amount: 3 });
  const post = await erpPostTool.execute(ctx, {
    document_id: 'nosub-1',
    confirm: 'CONFIRM_POST',
  });
  assert.equal(post.ok, false);
  assert.match(post.content, /submitted/);
});
