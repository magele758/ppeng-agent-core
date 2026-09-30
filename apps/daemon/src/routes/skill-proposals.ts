/**
 * Skill self-authoring review queue.
 *   GET/PATCH /api/skill-proposals/settings   persisted in daemon_control KV (no env switch)
 *   GET       /api/skill-proposals[?status=]  summaries (body preview)
 *   GET       /api/skill-proposals/:id        full record incl. complete body
 *   POST      /api/skill-proposals/:id/approve  install into stateDir/skills/<name>/SKILL.md
 *   POST      /api/skill-proposals/:id/reject   keep the record, mark rejected
 */

import type { RawAgentRuntime } from '@ppeng/agent-core';
import {
  ConflictError,
  NotFoundError,
  SKILL_PROPOSAL_REMIND_MAX,
  SkillProposalError,
  SkillProposalStore,
  ValidationError,
  hasPersistedSkillProposalSettings,
  isSkillProposalId,
  parseRemindEvery,
  readSkillProposalSettings,
  summarizeSkillProposal,
  writeSkillProposalSettings,
  type SkillProposalSettingsPatch,
  type SkillProposalStatus
} from '@ppeng/agent-core';
import type { RouteSpec } from '../routing.js';
import { json } from '../http-utils.js';

const STATUSES: readonly SkillProposalStatus[] = ['pending', 'approved', 'rejected'];

function mapError(error: unknown): never {
  if (error instanceof SkillProposalError) {
    if (error.code === 'not_found') throw new NotFoundError('skill proposal');
    if (error.code === 'conflict') throw new ConflictError(error.message);
    throw new ValidationError(error.message);
  }
  throw error;
}

export function skillProposalRoutes(runtime: RawAgentRuntime): RouteSpec[] {
  const store = () => new SkillProposalStore(runtime.stateDir);
  const settingsPayload = () => {
    const settings = readSkillProposalSettings(runtime.store);
    return {
      settings,
      effective: {
        enabled: settings.enabled,
        remindEveryNToolCalls: settings.remindEveryNToolCalls,
        source: hasPersistedSkillProposalSettings(runtime.store) ? ('ui' as const) : ('default' as const)
      }
    };
  };
  const requireId = (raw: string): string => {
    if (!isSkillProposalId(raw)) throw new NotFoundError('skill proposal');
    return raw;
  };

  return [
    {
      method: 'GET',
      pattern: '/api/skill-proposals/settings',
      handler: ({ response }) => json(response, 200, settingsPayload())
    },
    {
      method: 'PATCH',
      pattern: '/api/skill-proposals/settings',
      handler: async ({ readBody, response }) => {
        const body = ((await readBody()) ?? {}) as Record<string, unknown>;
        const patch: SkillProposalSettingsPatch = {};
        if ('enabled' in body) {
          if (typeof body.enabled !== 'boolean') throw new ValidationError('enabled must be a boolean');
          patch.enabled = body.enabled;
        }
        if ('remindEveryNToolCalls' in body) {
          const n = parseRemindEvery(body.remindEveryNToolCalls);
          if (n === undefined) {
            throw new ValidationError(
              `remindEveryNToolCalls must be an integer from 0 to ${SKILL_PROPOSAL_REMIND_MAX}`
            );
          }
          patch.remindEveryNToolCalls = n;
        }
        writeSkillProposalSettings(runtime.store, patch);
        json(response, 200, settingsPayload());
      }
    },
    {
      method: 'GET',
      pattern: '/api/skill-proposals',
      handler: ({ url, response }) => {
        const raw = url.searchParams.get('status');
        if (raw && !STATUSES.includes(raw as SkillProposalStatus)) {
          throw new ValidationError('status must be pending, approved, or rejected');
        }
        const proposals = store().list(raw ? { status: raw as SkillProposalStatus } : undefined);
        json(response, 200, { proposals: proposals.map(summarizeSkillProposal) });
      }
    },
    {
      method: 'GET',
      pattern: '/api/skill-proposals/:id',
      handler: ({ requireParam, response }) => {
        const record = store().get(requireId(requireParam('id')));
        if (!record) throw new NotFoundError('skill proposal');
        json(response, 200, { proposal: record });
      }
    },
    {
      method: 'POST',
      pattern: '/api/skill-proposals/:id/approve',
      handler: async ({ requireParam, response }) => {
        const id = requireId(requireParam('id'));
        try {
          const proposal = store().approve(id);
          const skills = await runtime.reloadWorkspaceSkills();
          const shadowedBy = skills.some(
            (s) => s.source === 'agents' && s.name === (proposal.replaces?.name ?? proposal.name)
          )
            ? ('agents' as const)
            : undefined;
          json(response, 200, { proposal, ...(shadowedBy ? { shadowedBy } : {}) });
        } catch (error) {
          mapError(error);
        }
      }
    },
    {
      method: 'POST',
      pattern: '/api/skill-proposals/:id/reject',
      handler: async ({ requireParam, readBody, response }) => {
        const id = requireId(requireParam('id'));
        const body = ((await readBody()) ?? {}) as { reason?: unknown };
        try {
          const proposal = store().reject(id, typeof body.reason === 'string' ? body.reason : undefined);
          json(response, 200, { proposal });
        } catch (error) {
          mapError(error);
        }
      }
    }
  ];
}
