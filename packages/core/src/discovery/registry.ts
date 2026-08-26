/**
 * Capability Registry — trust state machine + store facade.
 */

import { ValidationError } from '../errors.js';
import type {
  CapabilityBinding,
  CapabilityCard,
  CapabilityTrust,
  CreateBindingInput,
  CreateCapabilityInput,
  ListCapabilitiesFilter,
  UpdateCapabilityInput
} from './types.js';
import type { CapabilityStore } from './store.js';

/** Legal transitions. Bound may only be reached via explicit bind (approved). */
const ALLOWED: Record<CapabilityTrust, CapabilityTrust[]> = {
  untrusted: ['verified', 'revoked'],
  verified: ['bound', 'revoked', 'untrusted'],
  bound: ['revoked'],
  revoked: []
};

export function assertTrustTransition(from: CapabilityTrust, to: CapabilityTrust): void {
  if (from === to) return;
  const ok = ALLOWED[from]?.includes(to);
  if (!ok) {
    throw new ValidationError(`Illegal capability trust transition: ${from} → ${to}`);
  }
}

export class CapabilityRegistry {
  constructor(private readonly store: CapabilityStore) {}

  create(input: CreateCapabilityInput): CapabilityCard {
    if (input.trust === 'bound') {
      throw new ValidationError(
        'Cannot create capability with trust=bound; use bind() after HITL approval'
      );
    }
    const trust = input.trust ?? 'untrusted';
    if (trust !== 'untrusted' && trust !== 'verified' && trust !== 'revoked') {
      throw new ValidationError(`Invalid initial trust: ${trust}`);
    }
    return this.store.create({ ...input, trust });
  }

  get(id: string): CapabilityCard | undefined {
    return this.store.get(id);
  }

  list(filter: ListCapabilitiesFilter = {}): CapabilityCard[] {
    return this.store.list(filter);
  }

  update(id: string, input: UpdateCapabilityInput): CapabilityCard {
    const { trust, ...rest } = input;
    if (trust !== undefined) {
      return this.transitionTrust(id, trust);
    }
    return this.store.update(id, rest);
  }

  transitionTrust(id: string, to: CapabilityTrust): CapabilityCard {
    const card = this.store.get(id);
    if (!card) throw new ValidationError(`Capability not found: ${id}`);
    // Bound is only via bind({ approved: true }) — check before generic transition table.
    if (to === 'bound') {
      throw new ValidationError(
        'Use bind({ approved: true }) to transition to bound (HITL required)'
      );
    }
    assertTrustTransition(card.trust, to);
    return this.store.setTrust(id, to);
  }

  /**
   * HITL bind: verified|untrusted → bound + optional binding rows.
   * Requires approved=true; never auto-binds.
   */
  bind(
    id: string,
    opts: { approved: boolean; bindings?: Omit<CreateBindingInput, 'capabilityId'>[] }
  ): { card: CapabilityCard; bindings: CapabilityBinding[] } {
    if (!opts.approved) {
      throw new ValidationError('bind requires approved=true (HITL)');
    }
    const card = this.store.get(id);
    if (!card) throw new ValidationError(`Capability not found: ${id}`);
    if (card.trust === 'revoked') {
      throw new ValidationError('Cannot bind a revoked capability');
    }
    if (card.trust === 'bound') {
      const existing = this.store.listBindings(id);
      return { card, bindings: existing };
    }
    // Allow untrusted→bound only via this approved path (skip intermediate verified).
    // State machine: treat as verified→bound if already verified; else untrusted→verified then verified→bound.
    if (card.trust === 'untrusted') {
      this.store.setTrust(id, 'verified');
    }
    const bound = this.store.setTrust(id, 'bound');
    const bindings: CapabilityBinding[] = [];
    for (const b of opts.bindings ?? []) {
      bindings.push(
        this.store.createBinding({
          capabilityId: id,
          toolName: b.toolName,
          schemaHashPin: b.schemaHashPin,
          metadata: b.metadata
        })
      );
    }
    return { card: bound, bindings };
  }

  revoke(id: string): CapabilityCard {
    return this.transitionTrust(id, 'revoked');
  }

  listBindings(capabilityId: string): CapabilityBinding[] {
    return this.store.listBindings(capabilityId);
  }

  /** Bound tools only — for Tool Search index. */
  listBoundCards(filter: Omit<ListCapabilitiesFilter, 'trust'> = {}): CapabilityCard[] {
    return this.store.list({ ...filter, trust: 'bound' });
  }
}
