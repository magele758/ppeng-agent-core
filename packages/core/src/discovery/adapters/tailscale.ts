/**
 * Tailscale inventory adapter — parse `tailscale status --json` → candidate cards.
 * Prefer official CLI/API; never default to port scanning.
 */

import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { sanitizeSpawnEnv } from '../../sandbox/env-sanitizer.js';
import type { CreateCapabilityInput } from '../types.js';
import {
  resolveTailscaleDiscoveryEnabled,
  type DiscoverySettingsStore
} from '../settings.js';

export interface TailscalePeerLike {
  ID?: string;
  HostName?: string;
  DNSName?: string;
  OS?: string;
  TailscaleIPs?: string[];
  Tags?: string[];
  Online?: boolean;
  ExitNode?: boolean;
  ExitNodeOption?: boolean;
  PrimaryRoutes?: string[];
  CapMap?: Record<string, unknown>;
  Active?: boolean;
}

export interface TailscaleStatusJson {
  Version?: string;
  Self?: TailscalePeerLike;
  Peer?: Record<string, TailscalePeerLike>;
  MagicDNSSuffix?: string;
  BackendState?: string;
}

/** @deprecated Prefer resolveTailscaleDiscoveryEnabled(store, env). Kept for tests. */
export function tailscaleDiscoveryEnabled(
  env: NodeJS.ProcessEnv = process.env,
  store?: DiscoverySettingsStore
): boolean {
  return resolveTailscaleDiscoveryEnabled(store, env);
}

function peerRole(peer: TailscalePeerLike, isSelf: boolean): string {
  if (isSelf) return 'self';
  if (peer.ExitNode || peer.ExitNodeOption) return 'exit-node';
  if (peer.PrimaryRoutes && peer.PrimaryRoutes.length > 0) return 'subnet-router';
  if (peer.Tags && peer.Tags.length > 0) return 'tagged';
  return 'peer';
}

function poolId(status: TailscaleStatusJson): string {
  const suffix = status.MagicDNSSuffix?.replace(/\.$/, '') || 'unknown';
  const ip = status.Self?.TailscaleIPs?.[0];
  return ip ? `tailnet:${ip}` : `tailnet:${suffix}`;
}

export function parseTailscaleStatusJson(status: TailscaleStatusJson): CreateCapabilityInput[] {
  const pool = poolId(status);
  const out: CreateCapabilityInput[] = [];

  const add = (peer: TailscalePeerLike, isSelf: boolean) => {
    const host = peer.HostName || peer.DNSName || peer.ID || 'unknown';
    const ips = peer.TailscaleIPs ?? [];
    const endpoint = ips[0] || peer.DNSName || host;
    const online = peer.Online !== false && peer.Active !== false;
    out.push({
      kind: 'tailscale-node',
      name: host,
      description: `${peerRole(peer, isSelf)} node; online=${online}`,
      endpoint: String(endpoint),
      transport: 'tailscale',
      trust: 'untrusted',
      scope: online ? ['read', 'tailnet'] : ['read', 'tailnet', 'offline'],
      source: 'tailscale-status',
      pool,
      tags: peer.Tags ?? [],
      metadata: {
        nodeId: peer.ID,
        hostname: peer.HostName,
        dnsName: peer.DNSName,
        os: peer.OS,
        tailscaleIps: ips,
        online,
        operable: online,
        role: peerRole(peer, isSelf),
        capabilities: peer.CapMap ? Object.keys(peer.CapMap) : [],
        exitNode: Boolean(peer.ExitNode || peer.ExitNodeOption),
        primaryRoutes: peer.PrimaryRoutes ?? []
      }
    });
  };

  if (status.Self) add(status.Self, true);
  for (const peer of Object.values(status.Peer ?? {})) {
    add(peer, false);
  }
  return out;
}

export function loadTailscaleStatusFromFile(path: string): TailscaleStatusJson {
  return JSON.parse(readFileSync(path, 'utf8')) as TailscaleStatusJson;
}

export async function loadTailscaleStatusFromCli(
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 8_000
): Promise<TailscaleStatusJson> {
  return new Promise((resolve, reject) => {
    const child = spawn('tailscale', ['status', '--json'], {
      env: sanitizeSpawnEnv({ overrides: env }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('tailscale status timed out'));
    }, timeoutMs);
    child.stdout?.on('data', (d: Buffer) => {
      out += d.toString('utf8');
    });
    child.stderr?.on('data', (d: Buffer) => {
      err += d.toString('utf8');
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(err.trim() || `tailscale exited ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(out) as TailscaleStatusJson);
      } catch (e) {
        reject(e);
      }
    });
  });
}

/** Resolve status from settings/env mock file, else CLI. */
export async function resolveTailscaleStatus(
  env: NodeJS.ProcessEnv = process.env,
  options?: { statusJsonPath?: string }
): Promise<{ status: TailscaleStatusJson; source: 'file' | 'cli' }> {
  const file = options?.statusJsonPath?.trim() || env.RAW_AGENT_TAILSCALE_STATUS_JSON?.trim();
  if (file) {
    return { status: loadTailscaleStatusFromFile(file), source: 'file' };
  }
  const status = await loadTailscaleStatusFromCli(env);
  return { status, source: 'cli' };
}

export function candidatesFromEnvFile(env: NodeJS.ProcessEnv = process.env): CreateCapabilityInput[] {
  const file = env.RAW_AGENT_TAILSCALE_STATUS_JSON?.trim();
  if (!file) return [];
  return parseTailscaleStatusJson(loadTailscaleStatusFromFile(file));
}
