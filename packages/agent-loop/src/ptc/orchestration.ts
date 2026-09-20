import {
  SAVED_ORCHESTRATION_SCHEMA_V2,
  SAVED_ORCHESTRATION_SCHEMA_V3,
  type ReplayCapability,
  type ReplayRound,
  type ReplayWorker,
  type OrchestrationSlot,
  type SavedOrchestration
} from './types.js';

export function isV3Schema(schemaVersion: number | undefined): boolean {
  return typeof schemaVersion === 'number' && schemaVersion >= SAVED_ORCHESTRATION_SCHEMA_V3;
}

export function isNonEmptyProgram(program: unknown): program is string {
  return typeof program === 'string' && program.trim().length > 0;
}

function hasNonEmptySlots(slots: OrchestrationSlot[] | undefined): boolean {
  return Array.isArray(slots) && slots.length > 0;
}

function hasV2TaskTemplate(rounds: ReplayRound[] | undefined): boolean {
  return (
    Array.isArray(rounds) &&
    rounds.some(
      (r) =>
        Array.isArray(r?.workers) &&
        r.workers.some(
          (w) => typeof w?.taskTemplate === 'string' && w.taskTemplate.trim().length > 0
        )
    )
  );
}

/**
 * Content-derived capability. Presence of `program` never upgrades a v2 record.
 */
export function deriveReplayCapability(rec: {
  schemaVersion?: number;
  slots?: OrchestrationSlot[];
  rounds?: ReplayRound[];
  program?: string;
}): ReplayCapability {
  if (isV3Schema(rec.schemaVersion)) {
    if (isNonEmptyProgram(rec.program) && hasNonEmptySlots(rec.slots)) return 'hard_ready';
    return 'soft_only';
  }
  const hasSchema =
    typeof rec.schemaVersion === 'number' && rec.schemaVersion >= SAVED_ORCHESTRATION_SCHEMA_V2;
  if (hasSchema && hasNonEmptySlots(rec.slots) && hasV2TaskTemplate(rec.rounds)) {
    return 'hard_ready';
  }
  return 'soft_only';
}

export function normalizeSavedOrchestration(raw: unknown): SavedOrchestration {
  const rec = (raw && typeof raw === 'object' ? { ...(raw as object) } : {}) as SavedOrchestration;
  if (!Array.isArray(rec.rounds)) rec.rounds = [];
  rec.replayCapability = deriveReplayCapability(rec);
  return rec;
}

export function workerFingerprint(worker: ReplayWorker): string {
  if (typeof worker.id === 'string' && worker.id.trim()) return worker.id.trim();
  return `${String(worker.task ?? '').trim()}|${String(worker.angle ?? '').trim()}`;
}

export function dependsOnKey(deps: string[] | undefined): string {
  return (deps ?? []).map((d) => d.trim()).filter(Boolean).sort().join(',');
}
