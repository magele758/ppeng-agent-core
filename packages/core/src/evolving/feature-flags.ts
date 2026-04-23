import { envBool } from '../env.js';

export function evolvingMasterEnabled(env: NodeJS.ProcessEnv): boolean {
  return envBool(env, 'RAW_AGENT_EVOLVING', false);
}

export function evolvingReviewerEnabled(env: NodeJS.ProcessEnv): boolean {
  return evolvingMasterEnabled(env) && envBool(env, 'RAW_AGENT_EVOLVING_REVIEWER', true);
}

export function evolvingCoachEnabled(env: NodeJS.ProcessEnv): boolean {
  return evolvingMasterEnabled(env) && envBool(env, 'RAW_AGENT_EVOLVING_COACH', true);
}

/** Namespace for future tenant isolation; unused when unset. */
export function evolvingNamespaceFromSession(metadata: Record<string, unknown> | undefined): string | null {
  const raw = metadata?.evolvingNamespace;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return null;
}
