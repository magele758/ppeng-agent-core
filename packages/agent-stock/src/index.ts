/**
 * `@ppeng/agent-stock` — equity research domain bundle.
 *
 * Mounted via `RuntimeOptions.extraAgents / extraTools / extraSkills` (or
 * the daemon loader's `RAW_AGENT_DOMAINS=stock`). All tools are read-only
 * data fetchers; no order-placement / mutation tools are included.
 */

import type { DomainBundle } from '@ppeng/agent-core';
import { stockAgents } from './agents.js';
import { stockSkills } from './skills.js';
import { quoteGetTool } from './tools/quote.js';
import { fundamentalsGetTool } from './tools/fundamentals.js';
import { newsSearchTool } from './tools/news.js';

export const stockBundle: DomainBundle = {
  id: 'stock',
  label: 'Stock Agent',
  agents: stockAgents,
  tools: [quoteGetTool, fundamentalsGetTool, newsSearchTool],
  skills: stockSkills,
};

export { stockAgents, stockSkills };
export { quoteGetTool } from './tools/quote.js';
export { fundamentalsGetTool } from './tools/fundamentals.js';
export { newsSearchTool } from './tools/news.js';
