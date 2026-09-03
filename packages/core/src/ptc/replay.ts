import { createPtcAgentHook } from './agent-hook.js';
import { buildPtcNamespace } from './hooks.js';
import { runPtcProgram } from './isolate.js';
import {
  deriveReplayCapability,
  dependsOnKey,
  isNonEmptyProgram,
  isV3Schema,
  normalizeSavedOrchestration,
  workerFingerprint
} from './orchestration.js';
import type {
  OrchestrationSlot,
  PtcAgentSpec,
  PtcReplayErrorCode,
  ReplayRound,
  ReplayWorker,
  SavedOrchestration,
  SlotSource
} from './types.js';
import type { RunContext, ToolContract } from '../types.js';

export class PtcReplayError extends Error {
  readonly code: PtcReplayErrorCode;

  constructor(message: string, code: PtcReplayErrorCode) {
    super(message);
    this.name = 'PtcReplayError';
    this.code = code;
  }
}

export function assertHardReplayMode(taskRunMode: string | undefined): void {
  if (taskRunMode !== 'dynamic_workflow') {
    throw new PtcReplayError(
      'hard replay requires taskRunMode=dynamic_workflow',
      'INVALID_MODE'
    );
  }
}

export function assertHardReplayable(
  rec: SavedOrchestration | null | undefined
): asserts rec is SavedOrchestration {
  if (!rec) {
    throw new PtcReplayError('orchestration not found', 'NOT_FOUND');
  }
  if (deriveReplayCapability(rec) !== 'hard_ready') {
    throw new PtcReplayError(
      'orchestration is not hard-replayable (need v2 slots+templates or v3 program+slots)',
      'NOT_HARD_REPLAYABLE'
    );
  }
}

/**
 * Hard v2: locked rounds. Node order and dependsOn may not change.
 * Proposed topology is rejected when it differs from the saved lock.
 */
export function assertLockedRounds(
  locked: ReplayRound[],
  proposed: ReplayRound[]
): void {
  if (!Array.isArray(proposed)) {
    throw new PtcReplayError('proposed rounds missing', 'ROUND_ORDER_LOCKED');
  }
  if (proposed.length !== locked.length) {
    throw new PtcReplayError(
      `round count locked at ${locked.length}, got ${proposed.length}`,
      'ROUND_ORDER_LOCKED'
    );
  }
  for (let ri = 0; ri < locked.length; ri += 1) {
    const lockedWorkers = locked[ri]?.workers ?? [];
    const proposedWorkers = proposed[ri]?.workers ?? [];
    if (proposedWorkers.length !== lockedWorkers.length) {
      throw new PtcReplayError(
        `round ${ri + 1} worker count locked at ${lockedWorkers.length}`,
        'ROUND_ORDER_LOCKED'
      );
    }
    for (let wi = 0; wi < lockedWorkers.length; wi += 1) {
      const want = lockedWorkers[wi]!;
      const got = proposedWorkers[wi]!;
      if (workerFingerprint(want) !== workerFingerprint(got)) {
        throw new PtcReplayError(
          `round ${ri + 1} worker ${wi + 1} order/identity locked`,
          'ROUND_ORDER_LOCKED'
        );
      }
      if (dependsOnKey(want.dependsOn) !== dependsOnKey(got.dependsOn)) {
        throw new PtcReplayError(
          `round ${ri + 1} worker ${wi + 1} dependsOn locked`,
          'ROUND_ORDER_LOCKED'
        );
      }
    }
  }
}

export function renderTaskTemplate(
  template: string,
  slotValues: Record<string, string>
): string {
  if (typeof template !== 'string') {
    throw new PtcReplayError('taskTemplate invalid', 'SLOT_FILL_FAILED');
  }
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, name: string) => {
    if (!(name in slotValues) || slotValues[name] == null) {
      throw new PtcReplayError(`missing slot: ${name}`, 'SLOT_FILL_FAILED');
    }
    return String(slotValues[name]);
  });
}

export function fillSlotValues(
  slots: OrchestrationSlot[] | undefined,
  opts: { userGoal: string; prevRoundSummary?: string; literals?: Record<string, string> }
): Record<string, string> {
  if (!Array.isArray(slots) || slots.length === 0) {
    throw new PtcReplayError('orchestration has no slots', 'SLOT_FILL_FAILED');
  }
  const out: Record<string, string> = {};
  for (const slot of slots) {
    if (!slot?.name?.trim()) {
      throw new PtcReplayError('unnamed slot', 'SLOT_FILL_FAILED');
    }
    const source: SlotSource = slot.source;
    switch (source) {
      case 'user_goal': {
        const goal = (opts.userGoal ?? '').trim();
        if (!goal) {
          throw new PtcReplayError(`slot ${slot.name} (user_goal) empty`, 'SLOT_FILL_FAILED');
        }
        out[slot.name] = goal;
        break;
      }
      case 'literal': {
        const lit = opts.literals?.[slot.name];
        if (lit == null || String(lit).trim() === '') {
          throw new PtcReplayError(`slot ${slot.name} (literal) empty`, 'SLOT_FILL_FAILED');
        }
        out[slot.name] = String(lit);
        break;
      }
      case 'prev_round': {
        const prev = (opts.prevRoundSummary ?? '').trim();
        if (!prev) {
          throw new PtcReplayError(`slot ${slot.name} (prev_round) empty`, 'SLOT_FILL_FAILED');
        }
        out[slot.name] = prev;
        break;
      }
      default: {
        const _never: never = source;
        throw new PtcReplayError(`unknown slot.source: ${String(_never)}`, 'SLOT_FILL_FAILED');
      }
    }
  }
  return out;
}

function renderWorkerTask(worker: ReplayWorker, slotValues: Record<string, string>): string {
  const template =
    typeof worker.taskTemplate === 'string' && worker.taskTemplate.trim()
      ? worker.taskTemplate
      : worker.task;
  return renderTaskTemplate(template, slotValues);
}

export interface HardReplayRoundResult {
  roundIndex: number;
  workers: ReplayWorker[];
  summaries: string[];
}

export interface HardReplayResult {
  orchestration: SavedOrchestration;
  slotValues: Record<string, string>;
  rounds: HardReplayRoundResult[];
  synthesisContext: string;
  programResult?: { value: unknown; logs: string[] };
}

export interface RunHardReplayOpts {
  orchestration: SavedOrchestration;
  userGoal: string;
  taskRunMode?: string;
  /** If provided, must match locked rounds (order + dependsOn). */
  proposedRounds?: ReplayRound[];
  literals?: Record<string, string>;
  spawn?: (spec: PtcAgentSpec) => Promise<string>;
  authorizedTools?: ToolContract<any>[];
  context?: RunContext;
}

function summarizeWorker(content: string, worker: ReplayWorker, index: number): string {
  const tag = worker.title || worker.angle || `worker ${index + 1}`;
  return `${tag}: ${content}`;
}

async function runHardReplayV2(opts: RunHardReplayOpts): Promise<HardReplayResult> {
  const orchestration = normalizeSavedOrchestration(opts.orchestration);
  assertHardReplayable(orchestration);
  if (opts.proposedRounds) {
    assertLockedRounds(orchestration.rounds, opts.proposedRounds);
  }

  const spawn = opts.spawn;
  if (!spawn) {
    throw new PtcReplayError('hard v2 requires spawn()', 'NOT_HARD_REPLAYABLE');
  }

  const roundResults: HardReplayRoundResult[] = [];
  let prevRoundSummary: string | undefined;
  let lastSlotValues: Record<string, string> = {};

  for (let ri = 0; ri < orchestration.rounds.length; ri += 1) {
    const round = orchestration.rounds[ri]!;
    const slotsForRound = (orchestration.slots || []).filter(
      (s) => s.source !== 'prev_round' || ri > 0
    );
    const slotValues = fillSlotValues(slotsForRound, {
      userGoal: opts.userGoal,
      prevRoundSummary,
      literals: opts.literals
    });
    lastSlotValues = { ...lastSlotValues, ...slotValues };

    const summaries: string[] = [];
    const rendered = (round.workers ?? []).map((w) => ({
      worker: w,
      task: renderWorkerTask(w, slotValues)
    }));
    const outputs = await Promise.all(
      rendered.map(async ({ worker, task }) => {
        const content = await spawn({
          task,
          angle: worker.angle,
          agent: worker.agent,
          title: worker.title
        });
        return summarizeWorker(content, worker, 0);
      })
    );
    summaries.push(...outputs);
    const summary = summaries.join('\n\n');
    roundResults.push({ roundIndex: ri, workers: round.workers ?? [], summaries });
    prevRoundSummary = summary;
  }

  return {
    orchestration,
    slotValues: lastSlotValues,
    rounds: roundResults,
    synthesisContext: buildV2Synthesis(orchestration, opts.userGoal, lastSlotValues, roundResults)
  };
}

async function runHardReplayV3(opts: RunHardReplayOpts): Promise<HardReplayResult> {
  const orchestration = normalizeSavedOrchestration(opts.orchestration);
  assertHardReplayable(orchestration);
  if (!isNonEmptyProgram(orchestration.program)) {
    throw new PtcReplayError('v3 hard replay needs a non-empty program', 'NOT_HARD_REPLAYABLE');
  }

  const slotsForProgram = (orchestration.slots || []).filter((s) => s.source !== 'prev_round');
  const slotValues = fillSlotValues(slotsForProgram, {
    userGoal: opts.userGoal,
    literals: opts.literals
  });
  const code = renderTaskTemplate(orchestration.program, slotValues);

  const abortController = new AbortController();
  const spawn =
    opts.spawn ??
    (async () => {
      throw new Error('hard v3 program called agent() without spawn');
    });
  const agent = createPtcAgentHook({
    concurrencyCap: 16,
    maxCalls: 64,
    signal: abortController.signal,
    spawn
  });
  const context =
    opts.context ??
    ({
      repoRoot: '/tmp',
      stateDir: '/tmp',
      session: { id: 'ptc-hard-v3', metadata: { taskRunMode: 'dynamic_workflow' } },
      agent: { id: 'ptc' }
    } as unknown as RunContext);
  const ns = buildPtcNamespace({
    context: { ...context, abortSignal: abortController.signal },
    authorizedTools: opts.authorizedTools ?? [],
    agent,
    scratchpad: {
      write: async () => ({ ok: true }),
      read: async () => null,
      list: async () => []
    },
    verify: async () => ({ ok: true })
  });

  try {
    const programResult = await runPtcProgram(code, {
      abortController,
      hooks: ns.bindings
    });
    return {
      orchestration,
      slotValues,
      rounds: [],
      programResult,
      synthesisContext: buildV3Synthesis(orchestration, opts.userGoal, slotValues, programResult)
    };
  } catch (error) {
    abortController.abort();
    throw error;
  }
}

function buildV2Synthesis(
  orchestration: SavedOrchestration,
  userGoal: string,
  slotValues: Record<string, string>,
  rounds: HardReplayRoundResult[]
): string {
  const slotLines = Object.entries(slotValues)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
  const roundBlocks = rounds.map((r) => {
    return [`### round ${r.roundIndex + 1}`, ...r.summaries].join('\n');
  });
  return [
    '[hard replay] topology locked; synthesize from executed rounds. Do not change node order.',
    orchestration.name ? `name: ${orchestration.name}` : '',
    `goal: ${userGoal}`,
    'slots:',
    slotLines || '(none)',
    ...roundBlocks
  ]
    .filter(Boolean)
    .join('\n');
}

function buildV3Synthesis(
  orchestration: SavedOrchestration,
  userGoal: string,
  slotValues: Record<string, string>,
  programResult: { value: unknown; logs: string[] }
): string {
  const slotLines = Object.entries(slotValues)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
  let resultText: string;
  try {
    resultText = JSON.stringify(programResult.value, null, 2);
  } catch {
    resultText = String(programResult.value);
  }
  return [
    '[hard replay] saved program executed; synthesize from the result. Do not call ptc_exec.',
    orchestration.name ? `name: ${orchestration.name}` : '',
    `goal: ${userGoal}`,
    'slots:',
    slotLines || '(none)',
    '### program result',
    resultText || '(empty)',
    programResult.logs.length ? `logs:\n${programResult.logs.join('\n')}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Hard replay: v2 locks rounds; v3 reruns the saved program with current hooks.
 * Does not replay historical model parameters or tool I/O.
 */
export async function runHardReplay(opts: RunHardReplayOpts): Promise<HardReplayResult> {
  assertHardReplayMode(opts.taskRunMode ?? 'dynamic_workflow');
  const orchestration = normalizeSavedOrchestration(opts.orchestration);
  assertHardReplayable(orchestration);
  if (isV3Schema(orchestration.schemaVersion) && isNonEmptyProgram(orchestration.program)) {
    return runHardReplayV3({ ...opts, orchestration });
  }
  return runHardReplayV2({ ...opts, orchestration });
}
