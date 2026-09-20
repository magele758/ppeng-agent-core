/**
 * Loop assembly presets. Higher ranks include every lower rank's modules.
 *
 * mini   — portable kernel + memory store + recover / HITL / pack
 * normal — + tool-loop defaults, permission-mode, dirty-input, memory LIFO, autoCompact
 * full   — + working-log, EventLog/stepTx, rich prepare-view, appendix, run-profile, L4
 * max    — + PTC/vm, shell-policy, guardian, vault/otel/cbom/dyn-tools orchestration
 */

export const LOOP_PRESETS = ['mini', 'normal', 'full', 'max'] as const;
export type LoopPreset = (typeof LOOP_PRESETS)[number];

export const PRESET_RANK: Record<LoopPreset, number> = {
  mini: 0,
  normal: 1,
  full: 2,
  max: 3,
};

export function isLoopPreset(value: unknown): value is LoopPreset {
  return value === 'mini' || value === 'normal' || value === 'full' || value === 'max';
}

export function parseLoopPreset(raw: unknown): LoopPreset | undefined {
  return isLoopPreset(raw) ? raw : undefined;
}

export function presetAtLeast(current: LoopPreset, min: LoopPreset): boolean {
  return PRESET_RANK[current] >= PRESET_RANK[min];
}

export interface LoopModuleMeta {
  id: string;
  minPreset: LoopPreset;
  /** True when the module may touch Node built-ins (`fs` / `sqlite` / `vm` / async_hooks). */
  nodeOnly: boolean;
  /** Heavy modules must be `import()`'d — mini must never statically reach them. */
  load: 'static' | 'dynamic';
}

export const LOOP_MODULES: readonly LoopModuleMeta[] = [
  { id: 'kernel', minPreset: 'mini', nodeOnly: false, load: 'static' },
  { id: 'memory-store', minPreset: 'mini', nodeOnly: false, load: 'static' },
  { id: 'recovery', minPreset: 'mini', nodeOnly: false, load: 'static' },
  { id: 'hitl', minPreset: 'mini', nodeOnly: false, load: 'static' },
  { id: 'pack', minPreset: 'mini', nodeOnly: false, load: 'static' },
  { id: 'tool-loop', minPreset: 'normal', nodeOnly: false, load: 'static' },
  { id: 'permission-mode', minPreset: 'normal', nodeOnly: false, load: 'static' },
  { id: 'dirty-input-gate', minPreset: 'normal', nodeOnly: false, load: 'static' },
  { id: 'memory-compensation', minPreset: 'normal', nodeOnly: true, load: 'static' },
  { id: 'model-adapters', minPreset: 'normal', nodeOnly: false, load: 'static' },
  { id: 'auto-compact', minPreset: 'normal', nodeOnly: false, load: 'static' },
  { id: 'working-log', minPreset: 'full', nodeOnly: true, load: 'static' },
  { id: 'step-tx', minPreset: 'full', nodeOnly: false, load: 'static' },
  { id: 'event-log', minPreset: 'full', nodeOnly: false, load: 'static' },
  { id: 'event-log-sqlite', minPreset: 'full', nodeOnly: true, load: 'dynamic' },
  { id: 'prepare-view', minPreset: 'full', nodeOnly: false, load: 'static' },
  { id: 'context-appendix', minPreset: 'full', nodeOnly: false, load: 'static' },
  { id: 'run-profile', minPreset: 'full', nodeOnly: false, load: 'static' },
  { id: 'l4-agent-loop', minPreset: 'full', nodeOnly: false, load: 'static' },
  { id: 'file-compensation', minPreset: 'full', nodeOnly: true, load: 'dynamic' },
  { id: 'ptc', minPreset: 'max', nodeOnly: true, load: 'dynamic' },
  { id: 'shell-policy', minPreset: 'max', nodeOnly: false, load: 'static' },
  { id: 'guardian', minPreset: 'max', nodeOnly: false, load: 'static' },
  { id: 'vault', minPreset: 'max', nodeOnly: true, load: 'dynamic' },
  { id: 'otel', minPreset: 'max', nodeOnly: true, load: 'dynamic' },
  { id: 'cbom', minPreset: 'max', nodeOnly: false, load: 'dynamic' },
  { id: 'case-governance', minPreset: 'max', nodeOnly: false, load: 'dynamic' },
  { id: 'dyn-tools', minPreset: 'max', nodeOnly: false, load: 'dynamic' },
];

export function modulesForPreset(preset: LoopPreset): LoopModuleMeta[] {
  return LOOP_MODULES.filter((m) => presetAtLeast(preset, m.minPreset));
}

export function moduleIdsForPreset(preset: LoopPreset): string[] {
  return modulesForPreset(preset).map((m) => m.id);
}
