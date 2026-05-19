import { nowIso } from '../id.js';
import { OrchestratorStore } from './store.js';
import type { OrchestrationRun, OrchestrationStep, OrchestrationStage } from './types.js';
import type { SwarmRun, SwarmStatus } from '../swarm/types.js';

const BOOTSTRAP_STAGES: OrchestrationStage[] = ['classify', 'research', 'implement', 'review', 'test'];

const TERMINAL_SWARM: SwarmStatus[] = ['completed', 'failed', 'cancelled'];

export interface OrchestrationEngineDeps {
  store: OrchestratorStore;
  startSwarmForRun?: (run: OrchestrationRun) => Promise<void>;
  tickSwarm?: () => Promise<void>;
  getSwarmForOrchestrationRun?: (orchestrationRunId: string) => SwarmRun | undefined;
  runResearch?: (run: OrchestrationRun) => Promise<string>;
  runReview?: (run: OrchestrationRun) => Promise<string>;
  runTest?: (run: OrchestrationRun) => Promise<string>;
}

export class OrchestrationEngine {
  constructor(private readonly deps: OrchestrationEngineDeps) {}

  async tick(): Promise<void> {
    const pending = this.deps.store.listRuns({ status: 'pending', limit: 20 });
    for (const run of pending) {
      this.bootstrapSteps(run);
      this.deps.store.updateRunStatus(run.id, 'running');
      this.deps.store.appendEvent({
        runId: run.id,
        kind: 'run_started',
        actor: 'orchestrator',
        payloadJson: JSON.stringify({ at: nowIso() })
      });
    }

    const running = this.deps.store.listRuns({ status: 'running', limit: 20 });
    for (const run of running) {
      await this.advanceRun(run);
    }
  }

  private bootstrapSteps(run: OrchestrationRun): void {
    const existing = this.deps.store.listSteps(run.id);
    if (existing.length > 0) return;
    for (const stage of BOOTSTRAP_STAGES) {
      this.deps.store.createStep({
        runId: run.id,
        stage,
        executor: stage === 'implement' ? 'swarm' : stage,
        status: 'pending'
      });
    }
  }

  private async advanceRun(run: OrchestrationRun): Promise<void> {
    const steps = this.deps.store.listSteps(run.id);

    const active = steps.find((s) => s.status === 'running');
    if (active) {
      if (active.stage === 'implement') {
        this.tryCompleteImplementStep(run, active);
      }
      return;
    }

    const next = steps.find((s) => s.status === 'pending');
    if (!next) {
      this.deps.store.updateRunStatus(run.id, 'completed');
      this.deps.store.appendEvent({
        runId: run.id,
        kind: 'run_completed',
        actor: 'orchestrator'
      });
      return;
    }

    this.deps.store.updateStep(next.id, { status: 'running' });
    this.deps.store.appendEvent({
      runId: run.id,
      stepId: next.id,
      kind: 'step_started',
      actor: 'orchestrator',
      payloadJson: JSON.stringify({ stage: next.stage })
    });

    if (next.stage === 'research' && this.deps.runResearch) {
      const artifact = await this.deps.runResearch(run);
      this.completeStep(run, next, artifact);
      return;
    }

    if (next.stage === 'review' && this.deps.runReview) {
      const artifact = await this.deps.runReview(run);
      this.completeStep(run, next, artifact);
      return;
    }

    if (next.stage === 'test' && this.deps.runTest) {
      const artifact = await this.deps.runTest(run);
      this.completeStep(run, next, artifact);
      return;
    }

    if (next.stage === 'implement' && this.deps.startSwarmForRun) {
      await this.deps.startSwarmForRun(run);
      if (this.deps.tickSwarm) {
        await this.deps.tickSwarm();
      }
      return;
    }

    this.completeStep(run, next);
  }

  private tryCompleteImplementStep(run: OrchestrationRun, step: OrchestrationStep): void {
    const swarm = this.deps.getSwarmForOrchestrationRun?.(run.id);
    if (!swarm || !TERMINAL_SWARM.includes(swarm.status)) {
      return;
    }

    const failed = swarm.status === 'failed' || swarm.status === 'cancelled';
    this.deps.store.updateStep(step.id, {
      status: failed ? 'failed' : 'completed',
      outputArtifact: `swarm:${swarm.id}:${swarm.status}`,
      failureType: failed ? 'swarm_failed' : undefined
    });
    this.deps.store.appendEvent({
      runId: run.id,
      stepId: step.id,
      kind: 'step_completed',
      actor: 'orchestrator',
      payloadJson: JSON.stringify({ stage: step.stage, swarmId: swarm.id, swarmStatus: swarm.status })
    });

    if (failed) {
      this.deps.store.updateRunStatus(run.id, 'failed');
      this.deps.store.appendEvent({
        runId: run.id,
        kind: 'run_failed',
        actor: 'orchestrator',
        payloadJson: JSON.stringify({ swarmId: swarm.id })
      });
    }
  }

  private completeStep(run: OrchestrationRun, step: OrchestrationStep, outputArtifact?: string): void {
    this.deps.store.updateStep(step.id, {
      status: 'completed',
      outputArtifact: outputArtifact ?? `${step.stage}-done`
    });
    this.deps.store.appendEvent({
      runId: run.id,
      stepId: step.id,
      kind: 'step_completed',
      actor: 'orchestrator',
      payloadJson: JSON.stringify({ stage: step.stage })
    });
  }
}
