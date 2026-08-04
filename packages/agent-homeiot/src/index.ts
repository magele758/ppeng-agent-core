/**
 * `@ppeng/agent-homeiot` — Home Assistant northbound read-only domain bundle.
 *
 * Mounted via `RuntimeOptions.extraAgents / extraTools / extraSkills` (or
 * the daemon loader's `RAW_AGENT_DOMAINS=homeiot`). MVP tools are read-only;
 * mutating HA services must use `approvalMode: 'always'` and stay opt-in.
 */

import type { DomainBundle } from '@ppeng/agent-core';
import { homeiotAgents } from './agents.js';
import { homeiotSkills } from './skills.js';
import { haGetStateTool, haListEntitiesTool } from './tools/ha-entities.js';

export const homeiotBundle: DomainBundle = {
  id: 'homeiot',
  label: 'Home IoT / HA',
  agents: homeiotAgents,
  tools: [haListEntitiesTool, haGetStateTool],
  skills: homeiotSkills,
};

export { homeiotAgents, homeiotSkills };
export { haListEntitiesTool, haGetStateTool } from './tools/ha-entities.js';
