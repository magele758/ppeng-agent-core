/**
 * L3 embed entry: run the assembled loop against a caller-supplied surface store.
 *
 *   import { runTurnKernel } from '@ppeng/agent-core/turn';
 *   import { createMemorySurfaceStore } from '@ppeng/agent-core/session';
 *
 * Does not construct RawAgentRuntime, listen on a port, or read AUTH_TOKEN.
 */

import { createNormalAssembledLoop } from '@ppeng/agent-loop';
import type { SessionRecord } from '../types.js';
import { adaptTurnKernelStore } from './embed-host.js';
import type { RunTurnKernelInput } from './host.js';

export async function runTurnKernel(input: RunTurnKernelInput): Promise<SessionRecord> {
  const assembled = createNormalAssembledLoop({
    io: {
      model: input.model,
      store: adaptTurnKernelStore(input.store, {
        agent: input.agent,
        agents: input.agents
      }),
      tools: input.tools,
      repoRoot: input.repoRoot,
      stateDir: input.stateDir,
      maxTurns: input.maxTurns,
      env: process.env
    },
    config: { maxTurns: input.maxTurns ?? 32 }
  });
  return assembled.run(input.sessionId, {
    latch: input.latch,
    onModelStreamChunk: input.onModelStreamChunk,
    steerDrainPolicy: input.steerDrainPolicy
  });
}
