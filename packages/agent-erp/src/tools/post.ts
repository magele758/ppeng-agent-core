import type { ToolContract } from '@ppeng/agent-core';
import { postDocument } from '../state-machine.js';
import { fail, okJson, resolveStore } from './shared.js';

type PostArgs = {
  document_id: string;
  /** Secondary confirmation token — must be the literal string "CONFIRM_POST". */
  confirm: string;
  idempotency_key?: string;
};

export const erpPostTool: ToolContract<PostArgs> = {
  name: 'erp_post',
  description:
    'Post a submitted ERP document to the ledger (submitted → posted). Requires human approval (secondary confirmation) and confirm="CONFIRM_POST". Document must already be submitted via erp_submit.',
  inputSchema: {
    type: 'object',
    properties: {
      document_id: { type: 'string', description: 'Document id (must be status=submitted)' },
      confirm: {
        type: 'string',
        description: 'Must be exactly CONFIRM_POST to proceed (secondary confirmation)',
      },
      idempotency_key: {
        type: 'string',
        description: 'Optional idempotency key; replaying the same key on a posted doc is a no-op',
      },
    },
    required: ['document_id', 'confirm'],
  },
  approvalMode: 'always',
  sideEffectLevel: 'system',
  async execute(context, args) {
    const id = String(args.document_id ?? '').trim();
    if (!id) return fail('document_id is required');
    if (String(args.confirm ?? '').trim() !== 'CONFIRM_POST') {
      return fail('confirm must be exactly CONFIRM_POST (secondary confirmation)');
    }
    const store = resolveStore(context);
    const doc = store.get(id);
    if (!doc) return fail(`document not found: ${id}`);
    const result = postDocument(doc, {
      actor: context.agent?.id,
      idempotencyKey: args.idempotency_key,
    });
    if (!result.ok) return fail(result.error);
    store.put(result.value.document);
    if (result.value.ledger) {
      store.putLedger(result.value.ledger);
    }
    return okJson({
      document: result.value.document,
      ledger: result.value.ledger ?? store.ledgerForDocument(id) ?? null,
      replayed: result.value.ledger === null,
    });
  },
};
