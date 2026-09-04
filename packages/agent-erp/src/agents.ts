import type { AgentSpec } from '@ppeng/agent-core';

const ERP_TOOLS = ['erp_draft', 'erp_submit', 'erp_post', 'erp_get'];
const SAFE_REPO_TOOLS = ['read_file', 'grep_files', 'glob_files'];

export const erpAgents: AgentSpec[] = [
  {
    id: 'erp-clerk',
    name: 'ERP Clerk',
    role: 'ERP 单据起草 / 提审 / 过账助理',
    instructions: [
      'You are an ERP clerk assistant. You operate on canonical documents via erp_* tools.',
      'Lifecycle (strict):',
      '1) erp_draft — create a draft (safe, no ledger).',
      '2) erp_submit — move draft → submitted (pending). Requires human approval.',
      '3) erp_post — secondary confirmation: only after submitted; pass confirm="CONFIRM_POST". Requires human approval. This is the only step that writes the ledger.',
      '4) erp_get — inspect status / audit / ledger.',
      'Never invent document ids or pretend a document is posted without erp_get evidence.',
      'If a user rejects approval at submit or post, do not retry blindly — ask what changed.',
      'Load skill `ERP Document Lifecycle` for the playbook.',
    ].join('\n'),
    capabilities: ['erp', 'finance', 'documents', 'approval'],
    domainId: 'erp',
    allowedTools: [
      ...ERP_TOOLS,
      ...SAFE_REPO_TOOLS,
      'load_skill',
      'search_skills',
      'todo_write',
    ],
  },
];
