export type MessagePart =
  | { type: 'text'; text?: string }
  | { type: 'reasoning'; text?: string }
  | { type: 'image'; assetId?: string; mimeType?: string }
  | { type: 'tool_call'; name?: string; input?: unknown }
  | { type: 'tool_result'; name?: string; content?: string; ok?: boolean };

export type ChatMessage = {
  role: string;
  parts?: MessagePart[];
};

export type SessionSummary = {
  id: string;
  title: string;
  mode: string;
  status: string;
  agentId?: string;
};

export type AgentInfo = { id: string; role: string };

export type TaskSummary = {
  title: string;
  status?: string;
  ownerAgentId?: string;
  sessionId?: string;
};

export type ApprovalItem = { id: string; toolName: string; sessionId: string };

export type MailItem = {
  fromAgentId: string;
  toAgentId: string;
  status: string;
  createdAt: string;
  content: string;
};
