import type { ToolContract } from '@ppeng/agent-core';
import { submitDocument } from '../state-machine.js';
import { fail, okJson, resolveStore } from './shared.js';

type SubmitArgs = {
  document_id: string;
};

export const erpSubmitTool: ToolContract<SubmitArgs> = {
  name: 'erp_submit',
  description:
    'Submit a draft ERP document for approval (draft → submitted/pending). Requires human approval. Does not post to the ledger.',
  inputSchema: {
    type: 'object',
    properties: {
      document_id: { type: 'string', description: 'Document id from erp_draft' },
    },
    required: ['document_id'],
  },
  approvalMode: 'always',
  sideEffectLevel: 'workspace',
  async execute(context, args) {
    const id = String(args.document_id ?? '').trim();
    if (!id) return fail('document_id is required');
    const store = resolveStore(context);
    const doc = store.get(id);
    if (!doc) return fail(`document not found: ${id}`);
    const result = submitDocument(doc, { actor: context.agent?.id });
    if (!result.ok) return fail(result.error);
    store.put(result.value);
    return okJson({ document: result.value });
  },
};
