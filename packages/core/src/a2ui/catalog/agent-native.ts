/**
 * Agent-native catalog — components that map onto first-class concepts
 * in this runtime (tasks, agents, mailbox, approvals, sessions, traces).
 *
 * Renderer-side these components reuse `apps/web-console/lib/api.ts` so the
 * agent can ask for "show me my pending tasks" and the surface stays in sync
 * with whatever the Ops/Teams panels would show.
 *
 * Versioned via the URL: when the schema changes in a breaking way, bump
 * `/v1` to `/v2` and keep both registered for one release.
 */

import { registerCatalog, type CatalogSpec, type ComponentSpec } from './registry.js';

export const AGENT_NATIVE_CATALOG_ID = 'https://ppeng.dev/agent-core/a2ui/v1';

const NATIVE_COMPONENTS: ComponentSpec[] = [
  {
    name: 'TaskCard',
    description: 'Render a single TaskRecord summary; props: { taskId } or { task } literal.',
    containerKind: 'leaf'
  },
  {
    name: 'TaskList',
    description: 'List tasks; props: { filter?: { status?, ownerAgentId? }, limit? }.',
    containerKind: 'leaf'
  },
  {
    name: 'AgentBadge',
    description: 'Agent id + role chip; props: { agentId }.',
    containerKind: 'leaf',
    requiredProps: ['agentId']
  },
  {
    name: 'MailboxThread',
    description: 'Show mailbox items for an agent; props: { agentId, limit? }.',
    containerKind: 'leaf',
    requiredProps: ['agentId']
  },
  {
    name: 'ApprovalRequest',
    description: 'Pending approval card with Approve/Deny buttons; props: { approvalId }.',
    containerKind: 'leaf',
    requiredProps: ['approvalId']
  },
  {
    name: 'SessionLink',
    description: 'Clickable link/badge for another session; props: { sessionId, label? }.',
    containerKind: 'leaf',
    requiredProps: ['sessionId']
  },
  {
    name: 'TodoEditable',
    description: 'Editable todo list bound to /todos in the data model.',
    containerKind: 'leaf'
  },
  {
    name: 'DiffView',
    description: 'Unified diff renderer; props: { diff: string } or { path }.',
    containerKind: 'leaf'
  },
  {
    name: 'TraceMini',
    description: 'Recent trace events for a session; props: { sessionId, limit? }.',
    containerKind: 'leaf',
    requiredProps: ['sessionId']
  },

  /**
   * Future-extension placeholders. Renderer ships a graceful-degrade shell
   * (clickable info card) so the protocol layer never blocks a payload that
   * mentions these names. Real implementations land in follow-up PRs without
   * touching the catalog id.
   */
  {
    name: 'KnowledgeGraph',
    description: 'Node/edge graph placeholder (Cytoscape integration TBD); props: { title, nodes, edges, layout? }.',
    containerKind: 'leaf'
  },
  {
    name: 'ChartCard',
    description: 'Chart placeholder (Recharts integration TBD); props: { kind: bar|line|pie, data, ... }.',
    containerKind: 'leaf'
  }
];

export const AGENT_NATIVE_CATALOG: CatalogSpec = {
  id: AGENT_NATIVE_CATALOG_ID,
  label: 'ppeng-agent-core native catalog v1',
  components: Object.fromEntries(NATIVE_COMPONENTS.map((c) => [c.name, c]))
};

let registered = false;
export function registerAgentNativeCatalog(): void {
  if (registered) return;
  registerCatalog(AGENT_NATIVE_CATALOG);
  registered = true;
}
