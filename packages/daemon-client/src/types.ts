/**
 * 与 daemon HTTP API 对齐的轻量类型，完全本地定义（不依赖 @ppeng/agent-core 的运行时或类型），
 * 避免 CLI 等消费方被拖入 core 的重量级依赖图（aws-sdk / pg / redis / sharp 等）。
 *
 * 仅覆盖 CLI 现状用到的字段；需要更多字段时按需扩展。
 */

export interface MessagePart {
  type: string;
  text?: string;
  content?: string;
  name?: string;
  [key: string]: unknown;
}

export interface ChatMessage {
  role: string;
  parts: MessagePart[];
}

export interface SessionSummary {
  id: string;
  mode: string;
  status: string;
  agentId: string;
  title: string;
}

/** 会话流式事件（`event: model` 载荷），对齐 core `ModelStreamChunk`。 */
export type ModelStreamChunk =
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'tool_call_start'; toolCallId: string; name: string }
  | { type: 'tool_call_delta'; toolCallId: string; argumentsFragment: string }
  | { type: 'a2ui_message'; surfaceId: string; envelope: unknown }
  | { type: 'done'; stopReason: 'end' | 'tool_use' };
