import type { TaskMode } from '../runtime/run-profile.js';

export type TaskRunMode = TaskMode;
export type PtcOrchestrationEngine = 'legacy' | 'ptc';
export type OrchestrationReplay = 'soft' | 'hard';
export type ReplayCapability = 'soft_only' | 'hard_ready';
export type SlotSource = 'user_goal' | 'literal' | 'prev_round';

export const SAVED_ORCHESTRATION_SCHEMA_V2 = 2;
export const SAVED_ORCHESTRATION_SCHEMA_V3 = 3;

export type PtcIsolateErrorCode =
  | 'aborted'
  | 'forbidden'
  | 'runtime'
  | 'timeout';

export interface PtcCellResult {
  value: unknown;
  logs: string[];
}

export interface PtcAgentSpec {
  task: string;
  angle?: string;
  agent?: string;
  role?: string;
  title?: string;
  allowed_tools?: string[];
  model?: string;
}

export type PtcExecInput = {
  code: string;
  timeoutMs?: number;
};

export interface OrchestrationSlot {
  name: string;
  description?: string;
  source: SlotSource;
}

export interface ReplayWorker {
  id?: string;
  task: string;
  angle?: string;
  agent?: string;
  title?: string;
  taskTemplate?: string;
  dependsOn?: string[];
}

export interface ReplayRound {
  workers: ReplayWorker[];
}

/** Saved topology / program. No host-confirm or business-host fields. */
export interface SavedOrchestration {
  name?: string;
  goal?: string;
  rounds: ReplayRound[];
  schemaVersion?: number;
  slots?: OrchestrationSlot[];
  program?: string;
  synthesisHint?: string;
  replayCapability?: ReplayCapability;
}

export type PtcReplayErrorCode =
  | 'ROUND_ORDER_LOCKED'
  | 'NOT_HARD_REPLAYABLE'
  | 'INVALID_MODE'
  | 'SLOT_FILL_FAILED'
  | 'NOT_FOUND';
