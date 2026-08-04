import type { ToolContract } from '@ppeng/agent-core';
import { fail, okJson, resolveStore } from './shared.js';

type GetArgs = {
  document_id?: string;
  list?: boolean;
};

export const erpGetTool: ToolContract<GetArgs> = {
  name: 'erp_get',
  description:
    'Read an ERP document (and its ledger entry if posted). Read-only; no approval required.',
  inputSchema: {
    type: 'object',
    properties: {
      document_id: { type: 'string', description: 'Document id to fetch' },
      list: { type: 'boolean', description: 'List all documents when true (max 100)' },
    },
  },
  approvalMode: 'never',
  sideEffectLevel: 'none',
  async execute(context, args) {
    const store = resolveStore(context);
    if (args.list) {
      const docs = store.list().slice(0, 100);
      return okJson({ documents: docs, count: docs.length });
    }
    const id = String(args.document_id ?? '').trim();
    if (!id) return fail('document_id is required (or set list=true)');
    const doc = store.get(id);
    if (!doc) return fail(`document not found: ${id}`);
    const ledger = store.ledgerForDocument(id) ?? null;
    return okJson({ document: doc, ledger });
  },
};
