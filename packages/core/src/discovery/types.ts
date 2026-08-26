/**
 * Capability Discovery — Registry types.
 * Not related to packages/capability-gateway (IM channel gateway).
 */

export type CapabilityKind =
  | 'openapi'
  | 'mcp'
  | 'tailscale-node'
  | 'http'
  | 'ha-entity'
  | 'custom';

export type CapabilityTrust = 'untrusted' | 'verified' | 'bound' | 'revoked';

export type CapabilityTransport = 'http' | 'https' | 'mcp' | 'tailscale' | 'mqtt' | 'local' | 'other';

/** CBOM / schema pin payload stored with a bound capability. */
export interface CapabilityCbom {
  schemaHash?: string;
  toolNames?: string[];
  serverFingerprint?: string;
  pinnedAt?: string;
  /** Node identity pin for tailscale-node */
  nodeId?: string;
  dnsName?: string;
  tailscaleIps?: string[];
  extra?: Record<string, unknown>;
}

export interface CapabilityCard {
  id: string;
  kind: CapabilityKind;
  /** Display / search name */
  name: string;
  description?: string;
  endpoint: string;
  transport: CapabilityTransport;
  schemaRef?: string;
  schemaHash?: string;
  trust: CapabilityTrust;
  /** Scope labels, e.g. read, write, tailnet */
  scope: string[];
  /** Secret reference only — never inline secrets */
  credRef?: string;
  source: string;
  cbom?: CapabilityCbom;
  /** Operable pool tag, e.g. tailnet:<id> */
  pool?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CapabilityBinding {
  id: string;
  capabilityId: string;
  toolName: string;
  schemaHashPin: string;
  status: 'active' | 'revoked' | 'needs-reverify';
  boundAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface CreateCapabilityInput {
  kind: CapabilityKind;
  name: string;
  description?: string;
  endpoint: string;
  transport?: CapabilityTransport;
  schemaRef?: string;
  schemaHash?: string;
  /** Defaults to untrusted; bound is rejected unless approved via bind API */
  trust?: CapabilityTrust;
  scope?: string[];
  credRef?: string;
  source?: string;
  cbom?: CapabilityCbom;
  pool?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateCapabilityInput {
  name?: string;
  description?: string;
  endpoint?: string;
  transport?: CapabilityTransport;
  schemaRef?: string;
  schemaHash?: string;
  scope?: string[];
  credRef?: string;
  source?: string;
  cbom?: CapabilityCbom;
  pool?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  /** Trust changes must go through registry.transitionTrust / bind */
  trust?: CapabilityTrust;
}

export interface ListCapabilitiesFilter {
  trust?: CapabilityTrust;
  kind?: CapabilityKind;
  pool?: string;
  limit?: number;
  offset?: number;
}

export interface CreateBindingInput {
  capabilityId: string;
  toolName: string;
  schemaHashPin: string;
  metadata?: Record<string, unknown>;
}
