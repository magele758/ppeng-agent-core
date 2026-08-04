/**
 * CBOM + schema pin helpers.
 */

import { createHash } from 'node:crypto';
import { nowIso } from '../id.js';
import type { CapabilityCard, CapabilityCbom } from './types.js';
import type { CapabilityStore } from './store.js';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export function computeSchemaHash(schema: unknown): string {
  return createHash('sha256').update(canonicalJson(schema), 'utf8').digest('hex');
}

export function buildCbomPin(
  card: CapabilityCard,
  toolNames: string[],
  schema: unknown
): CapabilityCbom {
  const schemaHash = computeSchemaHash(schema);
  const md = card.metadata ?? {};
  return {
    schemaHash,
    toolNames: [...toolNames].sort(),
    pinnedAt: nowIso(),
    nodeId: typeof md.nodeId === 'string' ? md.nodeId : undefined,
    dnsName: typeof md.dnsName === 'string' ? md.dnsName : undefined,
    tailscaleIps: Array.isArray(md.tailscaleIps) ? (md.tailscaleIps as string[]) : undefined
  };
}

export interface PinCheckResult {
  ok: boolean;
  reason?: string;
  expected?: string;
  actual?: string;
}

export function checkSchemaPin(expectedHash: string, actualSchema: unknown): PinCheckResult {
  const actual = computeSchemaHash(actualSchema);
  if (expectedHash && actual === expectedHash) return { ok: true, expected: expectedHash, actual };
  return {
    ok: false,
    reason: 'schema_pin_mismatch',
    expected: expectedHash,
    actual
  };
}

export function assertPinOrThrow(expectedHash: string, actualSchema: unknown): void {
  const r = checkSchemaPin(expectedHash, actualSchema);
  if (!r.ok) {
    throw new Error(`CBOM schema pin failed: expected=${r.expected} actual=${r.actual}`);
  }
}

/** Look up active binding pin for a tool name; return mismatch if current schema drifts. */
export function checkToolBindingPin(
  store: CapabilityStore,
  toolName: string,
  actualSchema: unknown
): PinCheckResult & { bindingId?: string; capabilityId?: string } {
  // Scan bound cards' bindings — MVP: list all capabilities with trust=bound
  const bound = store.list({ trust: 'bound', limit: 500 });
  for (const card of bound) {
    for (const b of store.listBindings(card.id)) {
      if (b.status !== 'active') continue;
      if (b.toolName !== toolName) continue;
      const check = checkSchemaPin(b.schemaHashPin, actualSchema);
      return { ...check, bindingId: b.id, capabilityId: card.id };
    }
  }
  // No pin registered for this tool — allow (not all tools are discovery-bound)
  return { ok: true };
}

export function markBindingNeedsReverify(store: CapabilityStore, bindingId: string): void {
  store.setBindingStatus(bindingId, 'needs-reverify');
}
