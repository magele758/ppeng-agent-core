/**
 * Product-facing kernel event subscription.
 * Complements latch.emit — products register listeners instead of only
 * wrapping the internal iterator.
 */

import type { AgentStepEvent } from './host.js';

export type KernelHookListener = (event: AgentStepEvent) => void | Promise<void>;

export interface KernelHookRegistry {
  register(listener: KernelHookListener): () => void;
  onEvent(event: AgentStepEvent): Promise<void>;
}

export function createKernelHookRegistry(): KernelHookRegistry {
  const listeners = new Set<KernelHookListener>();
  return {
    register(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async onEvent(event) {
      for (const listener of listeners) {
        await listener(event);
      }
    }
  };
}

export function registerKernelHooks(
  registry: KernelHookRegistry,
  listener: KernelHookListener
): () => void {
  return registry.register(listener);
}
