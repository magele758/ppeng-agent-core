/**
 * List filters for `self-filtered` routes. The Router cannot filter response
 * rows, so list handlers pass their rows through these helpers.
 */
import {
  ownerVisibleTo,
  sessionOwnerId,
  type BotRecord,
  type CronJobRecord,
  type RawAgentRuntime,
  type RequestAuth,
  type ResourceOwnerStore,
  type TeamPlan
} from '@ppeng/agent-core';
import { OWNER_KIND } from './owners.js';

function sessionOwner(runtime: RawAgentRuntime, sessionId: string): { found: boolean; ownerId?: string } {
  const session = runtime.getSession(sessionId);
  return session ? { found: true, ownerId: sessionOwnerId(session) } : { found: false };
}

export function sessionVisible(runtime: RawAgentRuntime, sessionId: string, auth: RequestAuth): boolean {
  if (!auth.isolate) return true;
  const owner = sessionOwner(runtime, sessionId);
  return owner.found && ownerVisibleTo(owner.ownerId, auth);
}

export function visibleCronJobs(
  runtime: RawAgentRuntime,
  jobs: CronJobRecord[],
  auth: RequestAuth
): CronJobRecord[] {
  return jobs.filter((job) => sessionVisible(runtime, job.sessionId, auth));
}

/** Bots without an owner are a shared roster: everyone may list and open them. */
export function visibleBots(runtime: RawAgentRuntime, bots: BotRecord[], auth: RequestAuth): BotRecord[] {
  if (!auth.isolate) return bots;
  return bots.filter((bot) => {
    const owner = sessionOwner(runtime, bot.canonicalSessionId);
    return owner.found && (owner.ownerId === undefined || ownerVisibleTo(owner.ownerId, auth));
  });
}

export function visibleTeamPlans(
  runtime: RawAgentRuntime,
  owners: ResourceOwnerStore,
  plans: TeamPlan[],
  auth: RequestAuth
): TeamPlan[] {
  if (!auth.isolate) return plans;
  return plans.filter((plan) =>
    plan.sessionId
      ? sessionVisible(runtime, plan.sessionId, auth)
      : ownerVisibleTo(owners.ownerOf(OWNER_KIND.teamPlan, plan.id), auth)
  );
}
