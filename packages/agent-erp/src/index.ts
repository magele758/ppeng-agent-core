/**
 * `@ppeng/agent-erp` — ERP canonical draft/submit/post domain bundle.
 *
 * Mounted via `RuntimeOptions.extraAgents / extraTools / extraSkills` (or
 * the daemon loader's `RAW_AGENT_DOMAINS=erp`). Write path uses
 * `approvalMode: 'always'` on submit/post; draft/get are read-safe.
 */

import type { DomainBundle } from '@ppeng/agent-core';
import { erpAgents } from './agents.js';
import { erpSkills } from './skills.js';
import { erpDraftTool } from './tools/draft.js';
import { erpSubmitTool } from './tools/submit.js';
import { erpPostTool } from './tools/post.js';
import { erpGetTool } from './tools/get.js';

export const erpBundle: DomainBundle = {
  id: 'erp',
  label: 'ERP Agent',
  agents: erpAgents,
  tools: [erpDraftTool, erpSubmitTool, erpPostTool, erpGetTool],
  skills: erpSkills,
};

export { erpAgents, erpSkills };
export { erpDraftTool } from './tools/draft.js';
export { erpSubmitTool } from './tools/submit.js';
export { erpPostTool } from './tools/post.js';
export { erpGetTool } from './tools/get.js';
export {
  createDraft,
  submitDocument,
  postDocument,
  rejectDocument,
  voidDocument,
  isPosted,
  hasLedgerImpact,
  type ErpDocument,
  type ErpDocStatus,
  type ErpLedgerEntry,
} from './state-machine.js';
export { ErpStore, resetDefaultStore, getDefaultStore } from './store.js';
