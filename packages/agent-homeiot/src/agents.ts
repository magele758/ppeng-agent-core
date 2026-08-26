import type { AgentSpec } from '@ppeng/agent-core';

/**
 * Home IoT / Home Assistant personas.
 *
 * MVP is northbound read-only. Mutating HA services (turn_on / turn_off /
 * call_service) must use approvalMode: 'always' and stay out of the default
 * allowedTools list when added later.
 */
const HA_READONLY_TOOLS = ['ha_list_entities', 'ha_get_state'];
const SAFE_REPO_TOOLS = ['read_file', 'grep_files', 'glob_files'];

export const homeiotAgents: AgentSpec[] = [
  {
    id: 'ha-operator',
    name: 'HA Operator',
    role: 'Home Assistant 北向只读运维',
    instructions: [
      'You are a Home Assistant operator focused on read-only northbound inspection.',
      'Priorities:',
      '1) Inventory entities with ha_list_entities before answering about device state.',
      '2) Use ha_get_state for a specific entity_id; cite entity_id + state + key attributes.',
      '3) Never invent entity ids or states — call tools. If HOME_ASSISTANT_* env is missing, tell the user which variable to set.',
      '4) This persona is READ-ONLY. Do not propose or execute service calls / turn_on / turn_off unless a human explicitly enables a write tool with approval.',
      '5) Prefer domain filters (light, sensor, switch) to keep results small.',
      'Load skill `HA Read-only Playbook` for common entity patterns.',
    ].join('\n'),
    capabilities: ['homeiot', 'home-assistant', 'iot', 'readonly'],
    domainId: 'homeiot',
    allowedTools: [
      ...HA_READONLY_TOOLS,
      ...SAFE_REPO_TOOLS,
      'load_skill',
      'todo_write',
    ],
  },
];
