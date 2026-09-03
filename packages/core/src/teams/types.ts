export type TeamPlanStatus =
  | 'drafting'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TeamDagTaskStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'reviewing'
  | 'done'
  | 'failed'
  | 'cancelled';

export type TeamDagRole = 'planner' | 'coordinator' | 'worker' | 'reviewer';

export type TeamGateName = 'review' | 'regression' | 'release';

export type TeamGateChecker = 'human' | 'llm' | 'command';

export type TeamGateStatus =
  | 'pending'
  | 'running'
  | 'awaiting_human'
  | 'passed'
  | 'failed'
  | 'skipped';

export type TeamWorkspaceSyncMode = 'directory-copy' | 'git-worktree';

export type TeamPlannerSource = 'llm' | 'heuristic' | 'explicit';

export interface TeamDagEdge {
  from: string;
  to: string;
}

export interface TeamDagTask {
  id: string;
  title: string;
  description?: string;
  dependsOn: string[];
  role: TeamDagRole;
  status: TeamDagTaskStatus;
  sessionId?: string;
  workspaceId?: string;
  workspacePath?: string;
  taskId?: string;
  reviewPassed?: boolean;
  reviewFeedback?: string;
  error?: string;
}

export interface TeamGateState {
  name: TeamGateName;
  status: TeamGateStatus;
  checker: TeamGateChecker;
  command?: string;
  passed?: boolean;
  feedback?: string;
  decidedAt?: string;
}

export interface TeamPlan {
  id: string;
  sessionId?: string;
  objective: string;
  status: TeamPlanStatus;
  tasks: TeamDagTask[];
  edges: TeamDagEdge[];
  gates: TeamGateState[];
  workspaceSyncMode: TeamWorkspaceSyncMode;
  planDir?: string;
  releasable?: boolean;
  plannerSource?: TeamPlannerSource;
  createdAt: string;
  updatedAt: string;
}

export interface TeamPlanReview {
  id: string;
  planId: string;
  taskId: string;
  passed: boolean;
  feedback: string;
  reviewerAgentId: string;
  createdAt: string;
}

export interface TeamMailboxMessage {
  id: string;
  planId: string;
  type: string;
  from: string;
  to: string;
  content: string;
  taskId?: string;
  createdAt: string;
}

export type TeamGateEvent = 'start' | 'pass' | 'fail' | 'skip' | 'need_human';
