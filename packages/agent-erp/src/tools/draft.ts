import type { ToolContract } from '@ppeng/agent-core';
import { createDraft, type ErpDocType } from '../state-machine.js';
import { fail, nextDocId, okJson, resolveStore } from './shared.js';

type DraftArgs = {
  doc_type?: ErpDocType;
  amount?: number;
  currency?: string;
  memo?: string;
  payload?: Record<string, unknown>;
  id?: string;
};

export const erpDraftTool: ToolContract<DraftArgs> = {
  name: 'erp_draft',
  description:
    'Create an ERP document in draft status (canonical adapter). No ledger impact. Safe to call without approval.',
  inputSchema: {
    type: 'object',
    properties: {
      doc_type: {
        type: 'string',
        enum: ['journal', 'invoice', 'payment', 'generic'],
        description: 'Document type (default generic)',
      },
      amount: { type: 'number', description: 'Document amount' },
      currency: { type: 'string', description: 'ISO currency code (default CNY)' },
      memo: { type: 'string', description: 'Short description / memo' },
      payload: { type: 'object', description: 'Additional canonical fields' },
      id: { type: 'string', description: 'Optional document id' },
    },
  },
  approvalMode: 'never',
  sideEffectLevel: 'workspace',
  async execute(context, args) {
    const store = resolveStore(context);
    const id = String(args.id ?? '').trim() || nextDocId();
    if (store.get(id)) {
      return fail(`document already exists: ${id}`);
    }
    const payload: Record<string, unknown> = {
      ...(args.payload ?? {}),
    };
    if (args.amount !== undefined) payload.amount = args.amount;
    if (args.currency !== undefined) payload.currency = args.currency;
    if (args.memo !== undefined) payload.memo = args.memo;

    const created = createDraft({
      id,
      docType: args.doc_type,
      payload,
      actor: context.agent?.id,
    });
    if (!created.ok) return fail(created.error);
    store.put(created.value);
    return okJson({ document: created.value });
  },
};
