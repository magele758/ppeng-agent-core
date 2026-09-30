import type { RunContext, SkillSpec, ToolContract, ToolExecutionResult } from '../types.js';
import { readSkillProposalSettings, type SkillProposalSettingsStore } from './settings.js';
import { SkillProposalStore } from './store.js';
import {
  SKILL_PROPOSAL_BODY_MAX,
  SKILL_PROPOSAL_DESCRIPTION_MAX,
  SKILL_PROPOSAL_NAME_MAX,
  SkillProposalError,
  validateSkillProposalDraft
} from './validate.js';

export const SKILL_PROPOSE_TOOL_NAME = 'skill_propose';

export interface SkillProposeToolDeps {
  settingsStore?: SkillProposalSettingsStore;
  getStateDir(): string;
  listSkills(): Promise<SkillSpec[]>;
  emitTrace?: (sessionId: string, event: { kind: string; payload?: Record<string, unknown> }) => void;
}

function fail(content: string): ToolExecutionResult {
  return { ok: false, content };
}

function findExisting(skills: SkillSpec[], name: string): SkillSpec | undefined {
  return skills.find((skill) =>
    [skill.name, skill.id, ...(skill.aliases ?? [])].some(
      (key) => typeof key === 'string' && key.trim().toLowerCase() === name
    )
  );
}

export function createSkillProposeTool(deps: SkillProposeToolDeps): ToolContract<{
  name: string;
  description: string;
  body: string;
}> {
  return {
    name: SKILL_PROPOSE_TOOL_NAME,
    description:
      'Propose a reusable skill (a SKILL.md playbook) distilled from a workflow you just completed successfully. ' +
      'The proposal goes into a human review queue only; it is NOT installed or loadable until a person approves it in Lab. ' +
      `name: lowercase letters/digits separated by hyphens (max ${SKILL_PROPOSAL_NAME_MAX}). ` +
      `description: one line saying when to use it (max ${SKILL_PROPOSAL_DESCRIPTION_MAX} chars). ` +
      `body: markdown instructions without YAML frontmatter (max ${SKILL_PROPOSAL_BODY_MAX} chars). ` +
      'Never include secrets, tokens, or credentials. Reusing an existing skill name files an update proposal for review.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'kebab-case skill name' },
        description: { type: 'string', description: 'One-line trigger description' },
        body: { type: 'string', description: 'Markdown body of the skill (no frontmatter)' }
      },
      required: ['name', 'description', 'body']
    },
    approvalMode: 'never',
    sideEffectLevel: 'workspace',
    async execute(context: RunContext, args): Promise<ToolExecutionResult> {
      if (!readSkillProposalSettings(deps.settingsStore).enabled) {
        return fail('skill_propose is disabled. A human can enable it in Lab → More → Skill proposals.');
      }
      try {
        const draft = validateSkillProposalDraft(args);
        const existing = findExisting(await deps.listSkills(), draft.name);
        if (existing?.source === 'builtin') {
          return fail(`"${draft.name}" is a built-in skill and cannot be updated by proposal; choose a different name.`);
        }
        const record = new SkillProposalStore(deps.getStateDir()).create({
          ...draft,
          sessionId: context.session.id,
          agentId: context.agent.id,
          ...(existing ? { replaces: { name: existing.name, source: existing.source } } : {})
        });
        deps.emitTrace?.(context.session.id, {
          kind: 'skill_propose',
          payload: { proposalId: record.id, name: record.name, proposalKind: record.kind }
        });
        return {
          ok: true,
          content: JSON.stringify({
            ok: true,
            proposalId: record.id,
            name: record.name,
            kind: record.kind,
            status: 'pending',
            note: 'Queued for human review. It is not loadable until approved.'
          })
        };
      } catch (error) {
        if (error instanceof SkillProposalError) return fail(error.message);
        throw error;
      }
    }
  };
}
