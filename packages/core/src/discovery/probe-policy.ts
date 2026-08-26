/**
 * Probe policy — CIDR / host allowlist / active-scan gate (pure functions).
 * Network I/O is enforced by callers; this module only decides allow/deny.
 */

import { envBool, envInt } from '../env.js';

export interface ProbePolicy {
  activeScanEnabled: boolean;
  hostAllowlist: string[];
  cidrAllowlist: string[];
  timeoutMs: number;
  maxConcurrent: number;
  /** Forbidden port ranges inclusive, e.g. [[0, 0], [1, 1023]] for privileged */
  forbiddenPortRanges: Array<[number, number]>;
}

export interface ProbeTarget {
  host: string;
  port?: number;
  url?: string;
}

export interface ProbeDecision {
  allowed: boolean;
  reason?: string;
}

export function probePolicyFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  overrides?: Partial<Pick<ProbePolicy, 'activeScanEnabled' | 'hostAllowlist' | 'cidrAllowlist'>>
): ProbePolicy {
  const hosts = String(env.RAW_AGENT_DISCOVERY_HOST_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const cidrs = String(env.RAW_AGENT_DISCOVERY_CIDR_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const hostAllowlist =
    overrides?.hostAllowlist && overrides.hostAllowlist.length > 0
      ? overrides.hostAllowlist.map((s) => s.toLowerCase())
      : hosts;
  const cidrAllowlist =
    overrides?.cidrAllowlist && overrides.cidrAllowlist.length > 0
      ? overrides.cidrAllowlist
      : cidrs;
  return {
    activeScanEnabled:
      overrides?.activeScanEnabled !== undefined
        ? overrides.activeScanEnabled
        : envBool(env, 'RAW_AGENT_DISCOVERY_ACTIVE_SCAN', false),
    hostAllowlist,
    cidrAllowlist,
    timeoutMs: envInt(env, 'RAW_AGENT_DISCOVERY_PROBE_TIMEOUT_MS', 10_000),
    maxConcurrent: envInt(env, 'RAW_AGENT_DISCOVERY_PROBE_CONCURRENCY', 4),
    forbiddenPortRanges: [
      [0, 0],
      [1, 1023]
    ]
  };
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

/** Match host against CIDR (IPv4 only for MVP). */
export function hostInCidr(host: string, cidr: string): boolean {
  const [net, bitsStr] = cidr.split('/');
  if (!net || bitsStr === undefined) return false;
  const bits = Number(bitsStr);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const hostInt = ipv4ToInt(host);
  const netInt = ipv4ToInt(net);
  if (hostInt === null || netInt === null) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~0 << (32 - bits)) >>> 0;
  return (hostInt & mask) === (netInt & mask);
}

function hostnameFromTarget(target: ProbeTarget): string | null {
  if (target.host) return target.host.toLowerCase().replace(/\.$/, '');
  if (target.url) {
    try {
      return new URL(target.url).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  return null;
}

export function evaluateProbeTarget(policy: ProbePolicy, target: ProbeTarget): ProbeDecision {
  if (!policy.activeScanEnabled) {
    // Passive / allowlist-only mode: still allow if host is explicitly allowlisted or in CIDR.
  }

  const host = hostnameFromTarget(target);
  if (!host) {
    return { allowed: false, reason: 'invalid_target' };
  }

  if (target.port != null) {
    for (const [lo, hi] of policy.forbiddenPortRanges) {
      if (target.port >= lo && target.port <= hi) {
        return { allowed: false, reason: 'forbidden_port' };
      }
    }
  }

  const inHost = policy.hostAllowlist.some(
    (h) => host === h || host.endsWith(`.${h}`)
  );
  const inCidr = policy.cidrAllowlist.some((c) => hostInCidr(host, c));

  // If allowlists empty and active scan off → deny (safe default)
  if (policy.hostAllowlist.length === 0 && policy.cidrAllowlist.length === 0) {
    if (!policy.activeScanEnabled) {
      return { allowed: false, reason: 'no_allowlist' };
    }
    return { allowed: false, reason: 'active_scan_requires_allowlist' };
  }

  if (inHost || inCidr) {
    return { allowed: true };
  }
  return { allowed: false, reason: 'outside_allowlist' };
}

/** Tailscale CGNAT / unique local ranges commonly used in tailnets. */
export const TAILSCALE_CGNAT_CIDR = '100.64.0.0/10';

export function isTailscaleIp(ip: string): boolean {
  return hostInCidr(ip, TAILSCALE_CGNAT_CIDR);
}
