export type SwarmStatus =
  | 'pending'
  | 'planning'
  | 'running'
  | 'reviewing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type SwarmStrategy =
  | 'pipeline'
  | 'parallel-review'
  | 'best-of-n'
  | 'debate'
  | 'research-implement-review';

export type SwarmRole =
  | 'planner'
  | 'researcher'
  | 'implementer'
  | 'reviewer'
  | 'evaluator'
  | 'sre'
  | 'security';

export type SwarmTaskStatus =
  | 'pending'
  | 'claimed'
  | 'in_progress'
  | 'blocked'
  | 'review'
  | 'done'
  | 'failed';

export interface SwarmBudget {
  maxTeammates: number;
  maxTurnsPerAgent: number;
  maxDurationMs: number;
  maxCostUsd?: number;
}

export interface SwarmRun {
  id: string;
  goal: string;
  orchestrationRunId?: string;
  status: SwarmStatus;
  strategy: SwarmStrategy;
  budget: SwarmBudget;
  qualityGate: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SwarmTask {
  id: string;
  swarmRunId: string;
  title: string;
  description?: string;
  status: SwarmTaskStatus;
  requiredRole: SwarmRole;
  ownerAgentId?: string;
  capabilityTags: string[];
  acceptanceCriteria: string[];
  artifacts: string[];
  blockedBy: string[];
  budget?: { maxTurns?: number };
  createdAt: string;
  updatedAt: string;
}

export interface SwarmReview {
  id: string;
  swarmRunId: string;
  taskId: string;
  reviewerAgentId: string;
  role: SwarmRole;
  scores: {
    correctness?: number;
    testCoverage?: number;
    risk?: number;
    maintainability?: number;
    contractSafety?: number;
  };
  passed: boolean;
  feedback: string;
  createdAt: string;
}
