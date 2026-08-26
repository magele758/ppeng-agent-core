/**
 * API view types shared with the daemon via @ppeng/api-types.
 *
 * These are type-only re-exports. Local aliases preserve backward compatibility
 * with existing component imports.
 */
export type {
  ApiMessagePart as MessagePart,
  ApiChatMessage as ChatMessage,
  ApiSessionSummary as SessionSummary,
  ApiAgentInfo as AgentInfo,
  ApiTaskSummary as TaskSummary,
  ApiSocialPostScheduleItem as SocialPostScheduleItem,
  ApiApprovalItem as ApprovalItem,
  ApiMailItem as MailItem,
} from '@ppeng/api-types';
