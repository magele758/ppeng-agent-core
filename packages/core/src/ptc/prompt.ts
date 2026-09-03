import type { ReplayRound, SavedOrchestration } from './types.js';

export function buildSoftReplayHint(hint?: {
  name?: string;
  goal?: string;
  rounds?: ReplayRound[];
}): string {
  if (!hint || !Array.isArray(hint.rounds) || hint.rounds.length === 0) return '';
  const roundLines: string[] = [];
  hint.rounds.forEach((round, ri) => {
    roundLines.push(`Round ${ri + 1}:`);
    (round.workers || []).forEach((w, wi) => {
      const tags = [w.angle ? `angle: ${w.angle}` : '', w.agent ? `agent: ${w.agent}` : '']
        .filter(Boolean)
        .join('; ');
      roundLines.push(`  ${wi + 1}. ${w.task}${tags ? ` (${tags})` : ''}`);
    });
  });
  return [
    '## Saved orchestration (soft hint)',
    hint.name ? `Name: ${hint.name}` : '',
    hint.goal ? `Original goal: ${hint.goal}` : '',
    'Prefer this topology; you may still adjust it.',
    ...roundLines
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildHardReplayV2Block(meta?: {
  name?: string;
  slots?: Array<{ name: string; description?: string; source: string }>;
  synthesisHint?: string;
}): string {
  const slotLines = (meta?.slots ?? [])
    .map((s) => `- \`${s.name}\` (${s.source}): ${s.description ?? ''}`)
    .join('\n');
  return [
    '## Dynamic workflow hard replay (locked rounds)',
    '',
    'Topology is locked. The runtime fans out saved rounds in order.',
    '- Do not change node order or dependsOn.',
    '- `ptc_exec` and spawn tools are unavailable this turn.',
    '- Synthesize from executed worker results.',
    meta?.name ? `\nOrchestration: ${meta.name}` : '',
    slotLines ? `\nLocked slots:\n${slotLines}` : '',
    meta?.synthesisHint ? `\nSynthesis hint: ${meta.synthesisHint}` : ''
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function buildHardReplayV3Block(meta?: {
  name?: string;
  slots?: Array<{ name: string; description?: string; source: string }>;
  synthesisHint?: string;
}): string {
  const slotLines = (meta?.slots ?? [])
    .map((s) => `- \`${s.name}\` (${s.source}): ${s.description ?? ''}`)
    .join('\n');
  return [
    '## Dynamic workflow hard replay (saved program)',
    '',
    'The saved program is locked and executed by the runtime after slot fill.',
    '- Do not change topology. `ptc_exec` is unavailable.',
    '- Do not replay historical model parameters or tool I/O; use the fresh program result.',
    meta?.name ? `\nOrchestration: ${meta.name}` : '',
    slotLines ? `\nLocked slots:\n${slotLines}` : '',
    meta?.synthesisHint ? `\nSynthesis hint: ${meta.synthesisHint}` : ''
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function buildReplayPromptBlock(
  orchestration: SavedOrchestration | undefined,
  replay: 'soft' | 'hard'
): string {
  if (!orchestration) return '';
  if (replay !== 'hard') {
    return buildSoftReplayHint(orchestration);
  }
  const meta = {
    name: orchestration.name,
    slots: orchestration.slots,
    synthesisHint: orchestration.synthesisHint
  };
  if ((orchestration.schemaVersion ?? 0) >= 3) return buildHardReplayV3Block(meta);
  return buildHardReplayV2Block(meta);
}
