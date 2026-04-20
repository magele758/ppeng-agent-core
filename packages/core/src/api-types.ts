/**
 * Lightweight API response types for daemon ↔ web-console communication.
 *
 * These are Pick-based projections of the full domain types, matching
 * the shapes returned by the daemon HTTP API. Using Pick ensures they
 * stay in sync with the source-of-truth types.
 *
 * Web-console should `import type` from this module (compile-time only,
 * no runtime dependency on core's Node.js APIs).
 */

import type {
  AgentSpec,
  ApprovalRecord,
  MailRecord,
  MessagePart,
  SessionMessage,
  SessionRecord,
  TaskRecord,
} from './types.js';

/** Subset of SessionMessage for chat rendering. */
export type ApiChatMessage = Pick<SessionMessage, 'role' | 'parts'>;

/** Subset of SessionRecord for list views. */
export type ApiSessionSummary = Pick<SessionRecord, 'id' | 'title' | 'mode' | 'status' | 'agentId'>;

/** Subset of AgentSpec for agent lists. */
export type ApiAgentInfo = Pick<AgentSpec, 'id' | 'role' | 'name' | 'domainId'>;

/** Subset of TaskRecord for task list views. */
export type ApiTaskSummary = Pick<TaskRecord, 'title' | 'status' | 'ownerAgentId' | 'sessionId'>;

/** Social queue row for daemon + Ops panel. */
export type ApiSocialPostScheduleItem = {
  taskId: string;
  title: string;
  status: TaskRecord['status'];
  sessionId?: string;
  publishAt: string;
  channels: string[];
  approval: string;
  dispatchState: string;
  idempotencyKey: string;
};

/** Subset of ApprovalRecord for approval lists. */
export type ApiApprovalItem = Pick<ApprovalRecord, 'id' | 'toolName' | 'sessionId'>;

/** Subset of MailRecord for mail rendering. */
export type ApiMailItem = Pick<MailRecord, 'fromAgentId' | 'toAgentId' | 'status' | 'createdAt' | 'content'>;

/** Re-export MessagePart so web-console can use the canonical definition. */
export type { MessagePart as ApiMessagePart };
