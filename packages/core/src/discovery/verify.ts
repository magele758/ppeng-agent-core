/**
 * Verify candidate capabilities (schema hash / inventory checks).
 */

import { createHash } from 'node:crypto';
import type { CapabilityCard } from './types.js';
import type { CapabilityRegistry } from './registry.js';

export interface VerifyResult {
  ok: boolean;
  schemaHash?: string;
  reason?: string;
  card?: CapabilityCard;
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function hashPayload(payload: unknown): string {
  const canonical =
    typeof payload === 'string' ? payload : JSON.stringify(payload, Object.keys(payload as object).sort());
  return sha256Hex(canonical);
}

/** Tailscale inventory: require identity fields + optional online for verified. */
export function verifyTailscaleNode(card: CapabilityCard): VerifyResult {
  if (card.kind !== 'tailscale-node') {
    return { ok: false, reason: 'not_tailscale_node' };
  }
  const md = card.metadata ?? {};
  const hasId = Boolean(md.nodeId || md.dnsName || card.endpoint);
  if (!hasId) return { ok: false, reason: 'missing_identity' };
  const schemaHash = hashPayload({
    nodeId: md.nodeId,
    dnsName: md.dnsName,
    ips: md.tailscaleIps,
    endpoint: card.endpoint
  });
  return { ok: true, schemaHash };
}

/** OpenAPI/HTTP: hash provided body or schemaRef string (caller supplies body). */
export function verifySchemaBody(card: CapabilityCard, body: string): VerifyResult {
  if (!body.trim()) return { ok: false, reason: 'empty_body' };
  return { ok: true, schemaHash: sha256Hex(body) };
}

/**
 * Run verify and optionally promote untrusted → verified on the registry.
 * Never promotes to bound.
 */
export function applyVerify(
  registry: CapabilityRegistry,
  id: string,
  result: VerifyResult
): VerifyResult {
  const card = registry.get(id);
  if (!card) return { ok: false, reason: 'not_found' };
  if (!result.ok) return { ...result, card };
  if (result.schemaHash) {
    registry.update(id, { schemaHash: result.schemaHash });
  }
  if (card.trust === 'untrusted') {
    const next = registry.transitionTrust(id, 'verified');
    return { ok: true, schemaHash: result.schemaHash, card: next };
  }
  return { ok: true, schemaHash: result.schemaHash, card: registry.get(id) };
}

export function verifyCapability(card: CapabilityCard, opts?: { body?: string }): VerifyResult {
  if (card.kind === 'tailscale-node') return verifyTailscaleNode(card);
  if (opts?.body != null) return verifySchemaBody(card, opts.body);
  if (card.schemaHash) return { ok: true, schemaHash: card.schemaHash };
  return { ok: false, reason: 'no_schema_to_verify' };
}
