/**
 * L4 public barrel: AgentLoop SDK.
 * Import from `@ppeng/agent-core/loop`.
 *
 * Host implementations (L5 RawAgentRuntime) stay out of this module graph
 * so embedders can `createAgentLoop` without pulling SqliteStateStore.
 */

export {
  createAgentLoop,
  AgentLoopHandle,
  AgentLoopLatch
} from './runtime/agent-loop.js';
export type { AgentLoopHost, AgentStepEvent } from './runtime/agent-loop.js';
