import type { SkillSpec } from '@ppeng/agent-core';

const PLAYBOOK = `# ERP Document Lifecycle

Canonical tools (adapter-agnostic). Concrete ERP backends (Odoo/SAP/…) plug in behind these names later.

## States

\`\`\`
draft → submitted → posted   (+ ledger)
  │         │
  └─────────┴──→ void        (no ledger)
\`\`\`

## Tool map

| Tool | Transition | Approval |
|------|------------|----------|
| \`erp_draft\` | → draft | never |
| \`erp_submit\` | draft → submitted | **always** |
| \`erp_post\` | submitted → posted | **always** + \`confirm=CONFIRM_POST\` |
| \`erp_get\` | read | never |

## Rules

1. **Never post from draft** — submit first.
2. **Reject / deny approval** at submit or post leaves no ledger entry.
3. Prefer an \`idempotency_key\` on \`erp_post\` for safe retries.
4. After post, verify with \`erp_get\` (look for \`ledgerEntryId\` / ledger object).
`;

export const erpSkills: SkillSpec[] = [
  {
    id: 'erp-document-lifecycle',
    name: 'ERP Document Lifecycle',
    description: 'Canonical ERP draft → submit → post / void playbook with approval rules.',
    aliases: ['erp-lifecycle', 'erp-playbook'],
    triggerWords: ['erp', 'draft', 'submit', 'post', 'ledger', 'invoice', 'journal', '过账', '提审'],
    source: 'agents',
    content: PLAYBOOK,
  },
];
