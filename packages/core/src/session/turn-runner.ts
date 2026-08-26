import type { ModelStreamChunk, SessionRecord } from '../types.js';

/** Options passed into a single session run (streaming callbacks). */
export interface SessionTurnOptions {
  onModelStreamChunk?: (chunk: ModelStreamChunk) => void;
}

/**
 * Boundary type for the multi-turn session loop.
 * Implementation: {@link runSessionKernel} via {@link RawAgentRuntime.runSession}.
 */
export interface SessionTurnRunner {
  run(sessionId: string, options?: SessionTurnOptions): Promise<SessionRecord>;
}
