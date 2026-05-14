import type { DatabaseSync } from 'node:sqlite';
import { NotFoundError } from '../errors.js';
import { createId, nowIso } from '../id.js';
import { serializeJson, parseJson, optionalString } from '../stores/storage-helpers.js';
import type {
  FlywheelType,
  CapabilityTag,
  RiskLevel,
  OrchestrationStatus,
  OrchestrationStage,
  OrchestrationBudget,
  OrchestrationRun,
  OrchestrationStep,
  OrchestrationEvent
} from './types.js';

export interface CreateRunInput {
  title: string;
  sourceType?: string;
  sourceRef?: string;
  flywheels?: FlywheelType[];
  capabilityTags?: CapabilityTag[];
  riskLevel?: RiskLevel;
  budget?: OrchestrationBudget;
}

export interface UpdateStepInput {
  status?: string;
  outputArtifact?: string;
  failureType?: string;
  nextAction?: string;
}

export interface ListRunsOptions {
  status?: OrchestrationStatus;
  limit?: number;
  offset?: number;
}

export class OrchestratorStore {
  constructor(private readonly db: DatabaseSync) {}

  // ── Runs ──────────────────────────────────────────────────────────────────

  createRun(input: CreateRunInput): OrchestrationRun {
    const run: OrchestrationRun = {
      id: createId('orch'),
      title: input.title,
      sourceType: input.sourceType ?? '',
      sourceRef: input.sourceRef ?? '',
      flywheels: input.flywheels ?? [],
      capabilityTags: input.capabilityTags ?? [],
      riskLevel: input.riskLevel ?? 'low',
      status: 'pending',
      budget: input.budget,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    this.db
      .prepare(`
        INSERT INTO orchestration_runs
          (id, title, source_type, source_ref, flywheels, capability_tags, risk_level, status, budget, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        run.id,
        run.title,
        run.sourceType,
        run.sourceRef,
        serializeJson(run.flywheels),
        serializeJson(run.capabilityTags),
        run.riskLevel,
        run.status,
        run.budget != null ? serializeJson(run.budget) : null,
        run.createdAt,
        run.updatedAt
      );

    return run;
  }

  getRun(id: string): OrchestrationRun | undefined {
    const row = this.db
      .prepare(`SELECT * FROM orchestration_runs WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRunRow(row) : undefined;
  }

  updateRunStatus(id: string, status: OrchestrationStatus): OrchestrationRun {
    const run = this.getRun(id);
    if (!run) throw new NotFoundError('OrchestrationRun', id);
    const updatedAt = nowIso();
    this.db
      .prepare(`UPDATE orchestration_runs SET status = ?, updated_at = ? WHERE id = ?`)
      .run(status, updatedAt, id);
    return { ...run, status, updatedAt };
  }

  listRuns(opts?: ListRunsOptions): OrchestrationRun[] {
    const limit = opts?.limit ?? 100;
    const offset = opts?.offset ?? 0;
    const rows = (
      opts?.status
        ? this.db
            .prepare(
              `SELECT * FROM orchestration_runs WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
            )
            .all(opts.status, limit, offset)
        : this.db
            .prepare(`SELECT * FROM orchestration_runs ORDER BY created_at DESC LIMIT ? OFFSET ?`)
            .all(limit, offset)
    ) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRunRow(r));
  }

  // ── Steps ─────────────────────────────────────────────────────────────────

  createStep(
    input: Omit<OrchestrationStep, 'id' | 'createdAt' | 'updatedAt'>
  ): OrchestrationStep {
    const step: OrchestrationStep = {
      id: createId('ostep'),
      runId: input.runId,
      stage: input.stage,
      executor: input.executor,
      inputArtifact: input.inputArtifact,
      outputArtifact: input.outputArtifact,
      status: input.status ?? 'pending',
      failureType: input.failureType,
      nextAction: input.nextAction,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    this.db
      .prepare(`
        INSERT INTO orchestration_steps
          (id, run_id, stage, executor, input_artifact, output_artifact, status, failure_type, next_action, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        step.id,
        step.runId,
        step.stage,
        step.executor,
        step.inputArtifact ?? null,
        step.outputArtifact ?? null,
        step.status,
        step.failureType ?? null,
        step.nextAction ?? null,
        step.createdAt,
        step.updatedAt
      );

    return step;
  }

  getStep(id: string): OrchestrationStep | undefined {
    const row = this.db
      .prepare(`SELECT * FROM orchestration_steps WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapStepRow(row) : undefined;
  }

  updateStep(id: string, updates: UpdateStepInput): OrchestrationStep {
    const step = this.getStep(id);
    if (!step) throw new NotFoundError('OrchestrationStep', id);
    const updatedAt = nowIso();
    const next: OrchestrationStep = {
      ...step,
      ...(updates.status !== undefined && { status: updates.status }),
      ...(updates.outputArtifact !== undefined && { outputArtifact: updates.outputArtifact }),
      ...(updates.failureType !== undefined && { failureType: updates.failureType }),
      ...(updates.nextAction !== undefined && { nextAction: updates.nextAction }),
      updatedAt
    };
    this.db
      .prepare(`
        UPDATE orchestration_steps
        SET status = ?, output_artifact = ?, failure_type = ?, next_action = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        next.status,
        next.outputArtifact ?? null,
        next.failureType ?? null,
        next.nextAction ?? null,
        updatedAt,
        id
      );
    return next;
  }

  listSteps(runId: string): OrchestrationStep[] {
    const rows = this.db
      .prepare(`SELECT * FROM orchestration_steps WHERE run_id = ? ORDER BY created_at ASC`)
      .all(runId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapStepRow(r));
  }

  // ── Events ────────────────────────────────────────────────────────────────

  appendEvent(
    input: Omit<OrchestrationEvent, 'id' | 'createdAt'>
  ): OrchestrationEvent {
    const event: OrchestrationEvent = {
      id: createId('oevt'),
      runId: input.runId,
      stepId: input.stepId,
      kind: input.kind,
      actor: input.actor,
      payloadJson: input.payloadJson,
      createdAt: nowIso()
    };

    this.db
      .prepare(`
        INSERT INTO orchestration_events (id, run_id, step_id, kind, actor, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        event.id,
        event.runId,
        event.stepId ?? null,
        event.kind,
        event.actor,
        event.payloadJson ?? null,
        event.createdAt
      );

    return event;
  }

  listEvents(runId: string): OrchestrationEvent[] {
    const rows = this.db
      .prepare(`SELECT * FROM orchestration_events WHERE run_id = ? ORDER BY created_at ASC`)
      .all(runId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapEventRow(r));
  }

  // ── Mapping helpers ───────────────────────────────────────────────────────

  private mapRunRow(row: Record<string, unknown>): OrchestrationRun {
    return {
      id: String(row.id),
      title: String(row.title),
      sourceType: String(row.source_type ?? ''),
      sourceRef: String(row.source_ref ?? ''),
      flywheels: parseJson<FlywheelType[]>(String(row.flywheels ?? '[]')),
      capabilityTags: parseJson<CapabilityTag[]>(String(row.capability_tags ?? '[]')),
      riskLevel: String(row.risk_level ?? 'low') as RiskLevel,
      status: String(row.status) as OrchestrationStatus,
      budget: row.budget != null ? parseJson<OrchestrationBudget>(String(row.budget)) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private mapStepRow(row: Record<string, unknown>): OrchestrationStep {
    return {
      id: String(row.id),
      runId: String(row.run_id),
      stage: String(row.stage) as OrchestrationStage,
      executor: String(row.executor ?? ''),
      inputArtifact: optionalString(row.input_artifact),
      outputArtifact: optionalString(row.output_artifact),
      status: String(row.status),
      failureType: optionalString(row.failure_type),
      nextAction: optionalString(row.next_action),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private mapEventRow(row: Record<string, unknown>): OrchestrationEvent {
    return {
      id: String(row.id),
      runId: String(row.run_id),
      stepId: optionalString(row.step_id),
      kind: String(row.kind),
      actor: String(row.actor ?? ''),
      payloadJson: optionalString(row.payload_json),
      createdAt: String(row.created_at)
    };
  }
}
