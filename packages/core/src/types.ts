export type SessionMode = 'chat' | 'task' | 'subagent' | 'teammate';
export type SessionStatus = 'idle' | 'running' | 'waiting_approval' | 'completed' | 'failed';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type WorkspaceMode = 'git-worktree' | 'directory-copy';
export type SideEffectLevel = 'none' | 'workspace' | 'system';
export type ApprovalMode = 'never' | 'always' | 'auto';
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';
export type MailStatus = 'pending' | 'delivered' | 'read';
export type BackgroundJobStatus = 'running' | 'completed' | 'error';

/** primary = always-on guidance in system prompt; extension = catalog only until load_skill or explicit user request */
export type SkillTier = 'primary' | 'extension';

export interface SkillSpec {
  id: string;
  name: string;
  description: string;
  promptFragment?: string;
  content?: string;
  source?: 'builtin' | 'workspace';
  triggerWords?: string[];
  /** Builtins: primary vs extension. Workspace skills default to extension. */
  tier?: SkillTier;
}

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string;
}

/** Relative paths for structured harness handoffs (see Anthropic long-running harness pattern). */
export const HARNESS_ARTIFACT_DIR = '.raw-agent-harness';
export const HARNESS_ARTIFACT_FILES = {
  productSpec: 'product_spec.md',
  sprintContract: 'sprint_contract.md',
  evaluatorFeedback: 'evaluator_feedback.md'
} as const;

export interface AgentSpec {
  id: string;
  name: string;
  role: string;
  instructions: string;
  capabilities: string[];
  /** When set, built-in harness workflow hints apply (planner / generator / evaluator). */
  harnessRole?: 'planner' | 'generator' | 'evaluator';
  autonomous?: boolean;
  model?: string;
}

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ToolCallPart {
  type: 'tool_call';
  toolCallId: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultPart {
  type: 'tool_result';
  toolCallId: string;
  name: string;
  content: string;
  ok: boolean;
}

export type MessagePart = TextPart | ToolCallPart | ToolResultPart;

export interface SessionMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  parts: MessagePart[];
  createdAt: string;
}

export interface SessionRecord {
  id: string;
  title: string;
  mode: SessionMode;
  status: SessionStatus;
  agentId: string;
  taskId?: string;
  workspaceId?: string;
  parentSessionId?: string;
  background: boolean;
  summary?: string;
  todo: TodoItem[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TaskArtifact {
  kind: string;
  label: string;
  value: string;
}

export interface TaskRecord {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  ownerAgentId?: string;
  sessionId?: string;
  parentTaskId?: string;
  workspaceId?: string;
  blockedBy: string[];
  artifacts: TaskArtifact[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceRecord {
  id: string;
  taskId: string;
  name: string;
  mode: WorkspaceMode;
  sourcePath: string;
  rootPath: string;
  status: 'active' | 'archived';
  createdAt: string;
}

export interface ApprovalRecord {
  id: string;
  sessionId: string;
  toolName: string;
  status: ApprovalStatus;
  reason: string;
  args: Record<string, unknown>;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionMemoryEntry {
  id: string;
  sessionId: string;
  scope: 'scratch' | 'long';
  key: string;
  value: string;
  metadata: Record<string, unknown>;
  updatedAt: string;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  kind: string;
  actor: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface MailRecord {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  type: string;
  content: string;
  correlationId?: string;
  sessionId?: string;
  taskId?: string;
  status: MailStatus;
  createdAt: string;
  readAt?: string;
}

export interface BackgroundJobRecord {
  id: string;
  sessionId: string;
  command: string;
  status: BackgroundJobStatus;
  result?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunContext {
  repoRoot: string;
  stateDir: string;
  session: SessionRecord;
  agent: AgentSpec;
  workspaceRoot?: string;
  task?: TaskRecord;
  /** When aborted, long-running tools should stop. */
  abortSignal?: AbortSignal;
}

export interface ToolExecutionResult {
  ok: boolean;
  content: string;
  artifacts?: TaskArtifact[];
  metadata?: Record<string, unknown>;
}

export interface ToolContract<Args extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  approvalMode: ApprovalMode;
  sideEffectLevel: SideEffectLevel;
  execute: (context: RunContext, args: Args) => Promise<ToolExecutionResult>;
  needsApproval?: (context: RunContext, args: Args) => boolean;
}

export interface ModelTurnInput {
  agent: AgentSpec;
  systemPrompt: string;
  messages: SessionMessage[];
  tools: ToolContract<any>[];
  signal?: AbortSignal;
}

export interface ModelTurnResult {
  assistantParts: MessagePart[];
  stopReason: 'end' | 'tool_use';
}

export type ModelStreamChunk =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call_start'; toolCallId: string; name: string }
  | { type: 'tool_call_delta'; toolCallId: string; argumentsFragment: string }
  | { type: 'done'; stopReason: 'end' | 'tool_use' };

export interface SummaryInput {
  agent: AgentSpec;
  messages: SessionMessage[];
  reason: string;
}

export interface ModelAdapter {
  name: string;
  runTurn(input: ModelTurnInput): Promise<ModelTurnResult>;
  summarizeMessages(input: SummaryInput): Promise<string>;
  /** Optional streaming turn; default falls back to runTurn without chunks. */
  runTurnStream?(
    input: ModelTurnInput,
    onChunk: (chunk: ModelStreamChunk) => void
  ): Promise<ModelTurnResult>;
}
