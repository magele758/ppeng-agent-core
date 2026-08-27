/**
 * L3 embed entry: run the turn kernel against a caller-supplied surface store.
 *
 *   import { runTurnKernel } from '@ppeng/agent-core/turn';
 *   import { createMemorySurfaceStore } from '@ppeng/agent-core/session';
 *
 * Does not construct RawAgentRuntime, listen on a port, or read AUTH_TOKEN.
 */

import type { SessionRecord } from '../types.js';
import { createEmbedTurnHost } from './embed-host.js';
import type { RunTurnKernelInput } from './host.js';
import { runSessionKernel } from './kernel.js';

export async function runTurnKernel(input: RunTurnKernelInput): Promise<SessionRecord> {
  const host = createEmbedTurnHost(input);
  return runSessionKernel(host, input.sessionId, {
    latch: input.latch,
    onModelStreamChunk: input.onModelStreamChunk,
    steerDrainPolicy: input.steerDrainPolicy
  });
}
