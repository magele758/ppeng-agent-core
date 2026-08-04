import type { SkillSpec } from '@ppeng/agent-core';

const PLAYBOOK = `# HA Read-only Playbook (compact)

Northbound inspection only. Credentials stay in env (\`HOME_ASSISTANT_URL\`, \`HOME_ASSISTANT_TOKEN\`); never ask the user to paste a token into chat.

## 1. Inventory first

\`\`\`
ha_list_entities  → optional domain=light|sensor|switch|binary_sensor|climate
ha_get_state      → entity_id=light.living_room
\`\`\`

Start with a domain filter when the house has many entities.

## 2. How to read a state

| Field | Meaning |
|-------|---------|
| entity_id | Stable id (\`domain.object_id\`) |
| state | Current value (\`on\`/\`off\`, number as string, etc.) |
| attributes.friendly_name | Human label |
| attributes.unit_of_measurement | Sensors |
| last_changed / last_updated | Freshness |

## 3. Offline / CI

\`HOME_ASSISTANT_MOCK=1\` returns a fixed light + temperature sensor — no network.

## 4. Boundaries

- **Read-only MVP.** No \`call_service\` / turn_on / turn_off in this bundle.
- Future write tools must use \`approvalMode: 'always'\` and stay opt-in.
- Do not echo tokens or Authorization headers into replies.
`;

export const homeiotSkills: SkillSpec[] = [
  {
    id: 'ha-readonly-playbook',
    name: 'HA Read-only Playbook',
    description:
      'Home Assistant northbound read playbook: entity inventory, state reading, mock mode, and write-tool boundaries.',
    aliases: ['ha-playbook', 'homeassistant-readonly'],
    triggerWords: [
      'home assistant',
      'homeassistant',
      'HA',
      '实体',
      '智能家居',
      '灯',
      '传感器',
      'iot',
      'entity',
    ],
    source: 'agents',
    content: PLAYBOOK,
  },
];
