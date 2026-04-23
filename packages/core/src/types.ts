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

export interface SkillSpec {
  id: string;
  name: string;
  description: string;
  promptFragment?: string;
  content?: string;
  source?: 'builtin' | 'workspace' | 'agents';
  /** 仓库内 SKILL.md 的相对路径（workspace），agents 目录扫描时可为空 */
  skillPath?: string;
  /** Alternate names accepted by load_skill and considered during routing. */
  aliases?: string[];
  triggerWords?: string[];
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
  /**
   * When set, the runtime only exposes tools whose `name` is in this list to
   * this agent (in addition to the global isExternal gate). Use this to
   * scope a domain agent (e.g. SRE persona) so it cannot accidentally call
   * unrelated tools.
   */
  allowedTools?: string[];
  /**
   * Domain bundle the agent belongs to (e.g. "sre" / "stock"). Used by the
   * Web Console to group personas in the agent selector. Defaults to "core"
   * when undefined.
   */
  domainId?: string;
}

export interface TextPart {
  type: 'text';
  text: string;
}

/** Chain-of-thought / reasoning from the model (persisted for UI; replayed to the API as text). */
export interface ReasoningPart {
  type: 'reasoning';
  text: string;
}

/** Tier for image memory policy (hot=recent full res, warm=contact sheet / keyframe, cold=text-only archive). */
export type ImageRetentionTier = 'hot' | 'warm' | 'cold';

export interface ImagePart {
  type: 'image';
  assetId: string;
  mimeType: string;
  alt?: string;
  sourceUrl?: string;
  /** Denormalized; source of truth is image_assets table. */
  retentionTier?: ImageRetentionTier;
}

export interface ImageAssetRecord {
  id: string;
  sessionId: string;
  sha256: string;
  mimeType: string;
  sourceType: 'upload' | 'url' | 'derived';
  sourceUrl?: string;
  /** Relative to stateDir (e.g. images/<session>/<id>.png). */
  localRelPath: string;
  sizeBytes: number;
  derivedFromIds: string[];
  retentionTier: ImageRetentionTier;
  kind: 'original' | 'contact_sheet';
  lastAccessAt: string;
  createdAt: string;
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
  isExternal?: boolean;
}

/**
 * A2UI surface payload persisted on the assistant turn that produced it.
 *
 * The renderer folds the message stream into a per-surface state (component
 * map + data model). Persisting the raw envelope sequence (rather than the
 * folded state) means a session reload replays the surface deterministically
 * and stays compatible with future protocol versions.
 *
 * `messages` is intentionally typed as `unknown[]` here so this file stays
 * free of import cycles into the a2ui module; callers cast to A2uiMessage[]
 * at the boundary.
 */
export interface SurfaceUpdatePart {
  type: 'surface_update';
  surfaceId: string;
  catalogId: string;
  /** Sequence of A2uiMessage envelopes (createSurface / updateComponents / updateDataModel / deleteSurface). */
  messages: unknown[];
}

export type MessagePart = TextPart | ReasoningPart | ImagePart | ToolCallPart | ToolResultPart | SurfaceUpdatePart;

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
  /** Importance score (0-1) for retrieval prioritization. Higher = more relevant. */
  importance?: number;
  /** Number of times this memory has been accessed/referenced. */
  accessCount?: number;
  /** Last access timestamp for LRU-style eviction. */
  lastAccessAt?: string;
  /** Source of this memory entry (extracted, user_provided, inferred, consolidated). */
  source?: 'extracted' | 'user_provided' | 'inferred' | 'consolidated';
  /** IDs of memory entries that were merged into this one (for consolidated entries). */
  mergedFrom?: string[];
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
  /** Marks the tool as coming from an external AI CLI (e.g. claude_code, codex_exec). */
  isExternal?: boolean;
}

export interface ModelTurnInput {
  agent: AgentSpec;
  systemPrompt: string;
  messages: SessionMessage[];
  tools: ToolContract<any>[];
  signal?: AbortSignal;
  /** Resolve image asset id to data URL for VL requests (optional). */
  resolveImageDataUrl?: (assetId: string, signal?: AbortSignal) => Promise<string | undefined>;
  /** When `RAW_AGENT_DEBUG_LLM_PROMPT` is set, adapters may log sanitized request bodies here. */
  debugLlmContext?: { stateDir: string; sessionId: string };
}

export interface ModelTurnResult {
  assistantParts: MessagePart[];
  stopReason: 'end' | 'tool_use';
}

export type ModelStreamChunk =
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'tool_call_start'; toolCallId: string; name: string }
  | { type: 'tool_call_delta'; toolCallId: string; argumentsFragment: string }
  /**
   * Incremental A2UI surface update emitted by the runtime after a tool call
   * (e.g. `a2ui_render`) returns envelopes in `metadata.a2uiMessages`. The
   * `envelope` payload validates against the v0.9 schema; web clients fold
   * it into per-surface state and re-render in place.
   */
  | { type: 'a2ui_message'; surfaceId: string; envelope: unknown }
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

/** Preset npm script for self-heal test runs (whitelist). */
export type SelfHealTestPreset = 'unit' | 'regression' | 'e2e' | 'remote' | 'ci' | 'build';

export interface SelfHealPolicy {
  /** npm script preset or custom (see customNpmScript). */
  testPreset: SelfHealTestPreset | 'custom';
  /** When testPreset is custom: must be `npm run <script>` with allowed script name. */
  customNpmScript?: string;
  maxFixIterations: number;
  autoMerge: boolean;
  autoRestartDaemon: boolean;
  /** Branch to merge into from worktree branch (default: current branch at merge time). */
  targetBranch?: string;
  agentId?: string;
  /**
   * When true, the self-heal session's approval policy is set to auto-skip approval for
   * external AI tool calls (claude_code, codex_exec, cursor_agent).
   * Requires RAW_AGENT_EXTERNAL_AI_TOOLS=1 to expose those tools.
   */
  allowExternalAiTools?: boolean;
}

export type SelfHealStatus =
  | 'pending'
  | 'running_tests'
  | 'fixing'
  | 'tests_passed'
  | 'merging'
  | 'restart_pending'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'stopped';

export interface SelfHealRunRecord {
  id: string;
  status: SelfHealStatus;
  policy: SelfHealPolicy;
  taskId?: string;
  sessionId?: string;
  workspaceId?: string;
  worktreeBranch?: string;
  fixIteration: number;
  lastErrorSummary?: string;
  lastTestOutput?: string;
  mergeCommitSha?: string;
  blockReason?: string;
  stopped: boolean;
  restartRequestedAt?: string;
  restartAckAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SelfHealEventRecord {
  id: string;
  runId: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface DaemonRestartRequest {
  requestedAt: string;
  reason: string;
  runId?: string;
}
