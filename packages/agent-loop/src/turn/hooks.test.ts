import { describe, expect, it } from 'vitest';
import { createKernelHookRegistry, registerKernelHooks } from './hooks.js';

describe('kernel hooks', () => {
  it('registerKernelHooks delivers onEvent to subscribers', async () => {
    const registry = createKernelHookRegistry();
    const seen: string[] = [];
    const unsub = registerKernelHooks(registry, (ev) => {
      seen.push(ev.type);
    });
    await registry.onEvent({ type: 'turn_prepared', messageCount: 1 });
    await registry.onEvent({ type: 'ended', reason: 'end' });
    unsub();
    await registry.onEvent({ type: 'abort' });
    expect(seen).toEqual(['turn_prepared', 'ended']);
  });
});
