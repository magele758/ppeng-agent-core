#!/usr/bin/env node
/**
 * Evolution → Orchestrator bridge.
 * Converts an evolution inbox item into an OrchestrationRun via the daemon API.
 */
import { tagCapabilities } from './capability-tagger.mjs';

/** High-risk tags that block auto-merge (require PR / human approval). */
const HIGH_RISK_TAGS = new Set(['security', 'multi-user', 'contracts', 'deployment']);
/** Medium-risk tags (auto-merge with warning). */
const MEDIUM_RISK_TAGS = new Set(['runtime', 'web-console', 'domain-agents', 'cost-capacity']);

/**
 * Risk assessment based on capability tags.
 * @param {string[]} capabilityTags
 * @returns {'low' | 'medium' | 'high'}
 */
export function assessRiskLevel(capabilityTags) {
  if (capabilityTags.some(t => HIGH_RISK_TAGS.has(t))) return 'high';
  if (capabilityTags.some(t => MEDIUM_RISK_TAGS.has(t))) return 'medium';
  return 'low';
}

/**
 * Map capability tags to flywheel identifiers (A–H).
 * @param {string[]} capabilityTags
 * @returns {string[]} deduped FlywheelType[]
 */
export function tagsToFlywheels(capabilityTags) {
  const set = new Set();
  for (const tag of capabilityTags) {
    switch (tag) {
      case 'security':      set.add('E'); break;
      case 'cost-capacity': set.add('F'); break;
      case 'contracts':     set.add('G'); break;
      case 'agent-quality': set.add('H'); break;
      case 'deployment':    set.add('C'); break;
      case 'evolution':     set.add('A'); set.add('D'); break;
      case 'deepresearch':  set.add('A'); set.add('D'); break;
      case 'runtime':
      case 'web-console':
      case 'domain-agents':
      case 'memory':
      case 'multi-user':
      case 'swarm':
      case 'skills':
      case 'subagent':
        set.add('B'); set.add('D');
        break;
      default:
        break;
    }
  }
  return [...set];
}

/**
 * Convert an evolution inbox item into an OrchestrationRun.
 * Calls daemon API POST /api/orchestration/runs.
 *
 * @param {{ id?: string, title?: string, source?: string, url?: string, link?: string, summary?: string }} item
 * @param {{ daemonUrl?: string, capabilityTags?: string[], agent?: string, model?: string, budget?: object }} opts
 * @returns {Promise<{ runId: string, riskLevel: string, capabilityTags: string[], flywheels: string[] }>}
 */
export async function createOrchestrationRunForItem(item, opts = {}) {
  const daemonUrl = opts.daemonUrl || process.env.EVOLUTION_DAEMON_URL || 'http://127.0.0.1:7070';
  const title = item.title || item.id || '';
  const url = item.url || item.link || '';
  const summary = item.summary || '';

  // 1. Compute capability tags
  const capabilityTags = opts.capabilityTags ?? tagCapabilities({ title, url, summary });

  // 2. Assess risk level
  const riskLevel = assessRiskLevel(capabilityTags);

  // 3. Determine flywheels
  const rawFlywheels = tagsToFlywheels(capabilityTags);
  const flywheels = rawFlywheels.length > 0 ? rawFlywheels : ['D'];

  // 4. POST /api/orchestration/runs
  const payload = {
    title,
    sourceType: item.source || 'evolution-inbox',
    sourceRef: url,
    flywheels,
    capabilityTags,
    riskLevel,
    ...(opts.budget ? { budget: opts.budget } : {}),
    ...(opts.agent  ? { agent: opts.agent }   : {}),
    ...(opts.model  ? { model: opts.model }   : {}),
  };

  let runId = '';
  try {
    const res = await fetch(`${daemonUrl}/api/orchestration/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const data = await res.json();
      runId = data?.run?.id || data?.id || '';
    } else {
      const text = await res.text().catch(() => '');
      console.warn(
        `evolution-orchestrator-bridge: POST /api/orchestration/runs → HTTP ${res.status}: ${text.slice(0, 200)}`
      );
    }
  } catch (e) {
    console.warn(`evolution-orchestrator-bridge: POST /api/orchestration/runs error (non-fatal): ${e.message}`);
  }

  // 5. Return
  return { runId, riskLevel, capabilityTags, flywheels };
}

/**
 * Update an OrchestrationRun's status via PATCH /api/orchestration/runs/:id/status.
 * Non-fatal: errors are logged but not thrown.
 *
 * @param {string} runId
 * @param {'pending'|'running'|'completed'|'failed'|'blocked'} status
 * @param {{ daemonUrl?: string }} opts
 */
export async function updateOrchestrationRunStatus(runId, status, opts = {}) {
  if (!runId) return;
  const daemonUrl = opts.daemonUrl || process.env.EVOLUTION_DAEMON_URL || 'http://127.0.0.1:7070';
  try {
    const res = await fetch(`${daemonUrl}/api/orchestration/runs/${runId}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(
        `evolution-orchestrator-bridge: PATCH /api/orchestration/runs/${runId}/status → HTTP ${res.status}: ${text.slice(0, 200)}`
      );
    }
  } catch (e) {
    console.warn(`evolution-orchestrator-bridge: PATCH status error (non-fatal): ${e.message}`);
  }
}
