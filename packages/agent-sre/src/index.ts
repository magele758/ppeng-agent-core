/**
 * `@ppeng/agent-sre` — SRE on-call & postmortem domain bundle.
 *
 * Mounted via `RuntimeOptions.extraAgents / extraTools / extraSkills` (or
 * the daemon loader's `RAW_AGENT_DOMAINS=sre`). All tools are read-only;
 * mutating ops (k8s_apply / pagerduty_ack) are deferred and will land with
 * `approvalMode: 'always'`.
 */

import type { DomainBundle } from '@ppeng/agent-core';
import { sreAgents } from './agents.js';
import { sreSkills } from './skills.js';
import { promQueryTool } from './tools/prom.js';
import { lokiQueryTool } from './tools/loki.js';
import { k8sGetTool } from './tools/k8s.js';
import { pagerDutyListTool } from './tools/pagerduty.js';

export const sreBundle: DomainBundle = {
  id: 'sre',
  label: 'SRE Agent',
  agents: sreAgents,
  tools: [promQueryTool, lokiQueryTool, k8sGetTool, pagerDutyListTool],
  skills: sreSkills,
};

export { sreAgents, sreSkills };
export { promQueryTool } from './tools/prom.js';
export { lokiQueryTool } from './tools/loki.js';
export { k8sGetTool } from './tools/k8s.js';
export { pagerDutyListTool } from './tools/pagerduty.js';
