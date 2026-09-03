import type { SessionRecord } from '../types.js';
import {
  parseOrchestrationReplay,
  parseSkillScope,
  parseTaskMode,
  type OrchestrationReplay,
  type SkillScope
} from '../runtime/run-profile.js';
import type { PtcOrchestrationEngine, TaskRunMode } from './types.js';

function stringField(
  metadata: Record<string, unknown> | undefined,
  camel: string,
  snake: string
): string | undefined {
  const raw = metadata?.[camel] ?? metadata?.[snake];
  return typeof raw === 'string' ? raw.trim() : undefined;
}

export function parseTaskRunMode(raw: unknown): TaskRunMode | undefined {
  return parseTaskMode(raw);
}

export function parsePtcOrchestrationEngine(
  raw: unknown
): PtcOrchestrationEngine | undefined {
  return raw === 'legacy' || raw === 'ptc' ? raw : undefined;
}

/** Dynamic workflow defaults to PTC; only an explicit legacy choice opts out. */
export function resolvePtcOrchestrationEngine(
  raw: unknown,
  mode: unknown
): PtcOrchestrationEngine {
  const explicit = parsePtcOrchestrationEngine(raw);
  if (explicit) return explicit;
  return parseTaskRunMode(mode) === 'dynamic_workflow' ? 'ptc' : 'legacy';
}

export function taskRunModeFromSession(session: Pick<SessionRecord, 'metadata'>): TaskRunMode {
  return parseTaskRunMode(stringField(session.metadata, 'taskRunMode', 'task_run_mode')) ?? 'auto';
}

export function skillScopeFromSession(session: Pick<SessionRecord, 'metadata'>): SkillScope {
  return parseSkillScope(stringField(session.metadata, 'skillScope', 'skill_scope')) ?? 'full';
}

export function orchestrationReplayFromSession(
  session: Pick<SessionRecord, 'metadata'>
): OrchestrationReplay {
  return (
    parseOrchestrationReplay(
      stringField(session.metadata, 'orchestrationReplay', 'orchestration_replay')
    ) ?? 'soft'
  );
}

export function orchestrationEngineFromSession(
  session: Pick<SessionRecord, 'metadata'>
): PtcOrchestrationEngine {
  const mode = taskRunModeFromSession(session);
  const raw = stringField(
    session.metadata,
    'orchestrationEngine',
    'orchestration_engine'
  );
  return resolvePtcOrchestrationEngine(raw, mode);
}

export function isPtcSession(session: Pick<SessionRecord, 'metadata'>): boolean {
  return orchestrationEngineFromSession(session) === 'ptc';
}

export function ptcMetadataPatchFromInput(
  input: Record<string, unknown>
): Record<string, unknown> {
  const mode = parseTaskRunMode(input.taskRunMode ?? input.task_run_mode);
  const engine = parsePtcOrchestrationEngine(
    input.orchestrationEngine ?? input.orchestration_engine
  );
  const scope = parseSkillScope(input.skillScope ?? input.skill_scope);
  const replay = parseOrchestrationReplay(
    input.orchestrationReplay ?? input.orchestration_replay
  );
  const patch: Record<string, unknown> = {};
  if (mode) patch.taskRunMode = mode;
  if (engine) patch.orchestrationEngine = engine;
  if (scope) patch.skillScope = scope;
  if (replay) patch.orchestrationReplay = replay;
  const orch = input.ptcOrchestration ?? input.ptc_orchestration;
  if (orch && typeof orch === 'object' && !Array.isArray(orch)) {
    patch.ptcOrchestration = orch;
  }
  if (Array.isArray(input.requestedSkills)) {
    patch.requestedSkills = input.requestedSkills.map(String).map((s) => s.trim()).filter(Boolean);
  }
  return patch;
}

export type { SkillScope };
