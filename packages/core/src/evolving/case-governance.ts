/**
 * Case governance: decay confidence, archive low-value / over-capacity cases.
 * Status lives in agent_cases.status (migration v10); fail-soft never throws.
 */

import { envBool, envInt } from '../env.js';
import type { AgentCaseRecord, AgentCaseStore } from '../stores/agent-case-store.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_ACTIVE_CONFIDENCE = 0.05;

export function caseGovernanceEnabled(env: NodeJS.ProcessEnv): boolean {
  return envBool(env, 'RAW_AGENT_CASE_GOVERNANCE', true);
}

export function defaultHalfLifeDays(env: NodeJS.ProcessEnv): number {
  return Math.max(1, Math.min(365, envInt(env, 'RAW_AGENT_CASE_HALF_LIFE_DAYS', 30)));
}

export function caseCapacityLimit(env: NodeJS.ProcessEnv): number {
  return Math.max(1, Math.min(50_000, envInt(env, 'RAW_AGENT_CASE_CAPACITY', 2000)));
}

export function decayedConfidence(
  item: Pick<AgentCaseRecord, 'confidence' | 'createdAt' | 'halfLifeDays'>,
  now = Date.now(),
  defaultHalfLife = 30
): number {
  const halfLife = item.halfLifeDays ?? defaultHalfLife;
  const created = Date.parse(item.createdAt);
  if (!Number.isFinite(created)) return item.confidence;
  const ageDays = Math.max(0, (now - created) / DAY_MS);
  return item.confidence * Math.pow(0.5, ageDays / halfLife);
}

export interface GovernanceReport {
  archivedExpired: number;
  archivedDecayed: number;
  archivedCapacity: number;
}

/**
 * Run archive/decay/capacity enforcement. Idempotent; never throws.
 */
export function runCaseGovernance(
  store: AgentCaseStore,
  env: NodeJS.ProcessEnv,
  now = Date.now()
): GovernanceReport {
  const report: GovernanceReport = {
    archivedExpired: 0,
    archivedDecayed: 0,
    archivedCapacity: 0
  };
  if (!caseGovernanceEnabled(env)) return report;

  try {
    const halfLifeDefault = defaultHalfLifeDays(env);
    const capacity = caseCapacityLimit(env);
    const active = store.listActive(capacity + 500);

    for (const c of active) {
      const exp = c.expiresAt;
      if (exp && Date.parse(exp) < now) {
        store.setStatus(c.id, 'archived');
        report.archivedExpired++;
      }
    }

    const stillActive = store.listActive(capacity + 500);
    for (const c of stillActive) {
      const eff = decayedConfidence(c, now, halfLifeDefault);
      if (eff < MIN_ACTIVE_CONFIDENCE) {
        store.setStatus(c.id, 'archived');
        report.archivedDecayed++;
      }
    }

    const afterDecay = store.listActive(capacity + 500);
    if (afterDecay.length > capacity) {
      // Lowest effective confidence first, then oldest.
      const ranked = [...afterDecay].sort((a, b) => {
        const da = decayedConfidence(a, now, halfLifeDefault);
        const db = decayedConfidence(b, now, halfLifeDefault);
        if (da !== db) return da - db;
        return Date.parse(a.createdAt) - Date.parse(b.createdAt);
      });
      const overflow = ranked.slice(0, afterDecay.length - capacity);
      for (const c of overflow) {
        store.setStatus(c.id, 'archived');
        report.archivedCapacity++;
      }
    }
  } catch {
    /* fail-soft */
  }
  return report;
}
