/**
 * Re-export HTTP view types from @ppeng/api-types for backward compatibility.
 * Prefer importing from `@ppeng/api-types` in new Lab / client code.
 */

export type {
  ApiMessagePart,
  ApiChatMessage,
  ApiSessionSummary,
  ApiAgentInfo,
  ApiTaskSummary,
  ApiSocialPostScheduleItem,
  ApiApprovalItem,
  ApiMailItem,
} from '@ppeng/api-types';
