import {
  NotFoundError,
  OrchestratorStore,
  type RawAgentRuntime,
  type OrchestrationStatus,
  type OrchestrationStage,
  type FlywheelType,
  type CapabilityTag,
  type RiskLevel
} from '@ppeng/agent-core';
import type { RouteSpec } from '../routing.js';
import { json } from '../http-utils.js';

export function orchestrationRoutes(runtime: RawAgentRuntime): RouteSpec[] {
  const store = new OrchestratorStore(runtime.store.db);

  return [
    {
      method: 'GET',
      pattern: '/api/orchestration/runs',
      handler: ({ url, response }) => {
        const status = url.searchParams.get('status') as OrchestrationStatus | null;
        const limit = Number(url.searchParams.get('limit') ?? 100);
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const runs = store.listRuns({
          status: status ?? undefined,
          limit: Number.isFinite(limit) ? limit : 100,
          offset: Number.isFinite(offset) ? offset : 0
        });
        json(response, 200, { runs });
      }
    },
    {
      method: 'POST',
      pattern: '/api/orchestration/runs',
      handler: async ({ readBody, response }) => {
        const body = (await readBody()) as Record<string, unknown>;
        const run = store.createRun({
          title: String(body.title ?? 'Untitled'),
          sourceType: typeof body.sourceType === 'string' ? body.sourceType : undefined,
          sourceRef: typeof body.sourceRef === 'string' ? body.sourceRef : undefined,
          flywheels: Array.isArray(body.flywheels) ? (body.flywheels as FlywheelType[]) : undefined,
          capabilityTags: Array.isArray(body.capabilityTags)
            ? (body.capabilityTags as CapabilityTag[])
            : undefined,
          riskLevel: typeof body.riskLevel === 'string' ? (body.riskLevel as RiskLevel) : undefined,
          budget: typeof body.budget === 'object' && body.budget != null
            ? (body.budget as { maxTurns?: number; maxCostUsd?: number; maxDurationMs?: number })
            : undefined
        });
        json(response, 201, { run });
      }
    },
    {
      method: 'GET',
      pattern: '/api/orchestration/runs/:id',
      handler: ({ requireParam, response }) => {
        const id = requireParam('id');
        const run = store.getRun(id);
        if (!run) throw new NotFoundError('OrchestrationRun', id);
        const steps = store.listSteps(id);
        const events = store.listEvents(id);
        json(response, 200, { run, steps, events });
      }
    },
    {
      method: 'PATCH',
      pattern: '/api/orchestration/runs/:id/status',
      handler: async ({ requireParam, readBody, response }) => {
        const id = requireParam('id');
        const body = (await readBody()) as Record<string, unknown>;
        const status = String(body.status ?? '') as OrchestrationStatus;
        const run = store.updateRunStatus(id, status);
        json(response, 200, { run });
      }
    },
    {
      method: 'GET',
      pattern: '/api/orchestration/runs/:id/steps',
      handler: ({ requireParam, response }) => {
        const id = requireParam('id');
        const steps = store.listSteps(id);
        json(response, 200, { steps });
      }
    },
    {
      method: 'POST',
      pattern: '/api/orchestration/runs/:id/steps',
      handler: async ({ requireParam, readBody, response }) => {
        const runId = requireParam('id');
        const run = store.getRun(runId);
        if (!run) throw new NotFoundError('OrchestrationRun', runId);
        const body = (await readBody()) as Record<string, unknown>;
        const step = store.createStep({
          runId,
          stage: String(body.stage ?? 'implement') as OrchestrationStage,
          executor: typeof body.executor === 'string' ? body.executor : '',
          inputArtifact: typeof body.inputArtifact === 'string' ? body.inputArtifact : undefined,
          outputArtifact: typeof body.outputArtifact === 'string' ? body.outputArtifact : undefined,
          status: typeof body.status === 'string' ? body.status : 'pending',
          failureType: typeof body.failureType === 'string' ? body.failureType : undefined,
          nextAction: typeof body.nextAction === 'string' ? body.nextAction : undefined
        });
        json(response, 201, { step });
      }
    },
    {
      method: 'GET',
      pattern: '/api/orchestration/runs/:id/events',
      handler: ({ requireParam, response }) => {
        const id = requireParam('id');
        const events = store.listEvents(id);
        json(response, 200, { events });
      }
    }
  ];
}
