export type FlywheelType = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';

export type CapabilityTag =
  | 'runtime' | 'web-console' | 'evolution' | 'domain-agents'
  | 'security' | 'cost-capacity' | 'contracts' | 'deployment'
  | 'agent-quality' | 'memory' | 'multi-user' | 'deepresearch'
  | 'swarm' | 'skills' | 'subagent';

export type OrchestrationStage =
  | 'classify' | 'research' | 'design' | 'implement'
  | 'review' | 'test' | 'deploy-smoke' | 'retrospective'
  | 'done' | 'blocked';

export type OrchestrationStatus =
  | 'pending' | 'running' | 'waiting_approval'
  | 'completed' | 'failed' | 'blocked';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface OrchestrationBudget {
  maxTurns?: number;
  maxCostUsd?: number;
  maxDurationMs?: number;
}

export interface OrchestrationRun {
  id: string;
  title: string;
  sourceType: string;
  sourceRef: string;
  flywheels: FlywheelType[];
  capabilityTags: CapabilityTag[];
  riskLevel: RiskLevel;
  status: OrchestrationStatus;
  budget?: OrchestrationBudget;
  createdAt: string;
  updatedAt: string;
}

export interface OrchestrationStep {
  id: string;
  runId: string;
  stage: OrchestrationStage;
  executor: string;
  inputArtifact?: string;
  outputArtifact?: string;
  status: string;
  failureType?: string;
  nextAction?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrchestrationEvent {
  id: string;
  runId: string;
  stepId?: string;
  kind: string;
  actor: string;
  payloadJson?: string;
  createdAt: string;
}
