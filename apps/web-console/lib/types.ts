/**
 * API view types shared with @ppeng/agent-core.
 *
 * These are type-only re-exports from core's api-types module.
 * The `import type` syntax ensures no runtime code from core is bundled.
 * Local aliases preserve backward compatibility with existing component imports.
 */
export type {
  ApiMessagePart as MessagePart,
  ApiChatMessage as ChatMessage,
  ApiSessionSummary as SessionSummary,
  ApiAgentInfo as AgentInfo,
  ApiTaskSummary as TaskSummary,
  ApiApprovalItem as ApprovalItem,
  ApiMailItem as MailItem,
} from '@ppeng/agent-core';
