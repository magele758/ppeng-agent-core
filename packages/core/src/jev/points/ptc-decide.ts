/**
 * PTC cell semantic decide helpers. Host injects `jev.noul` / `jev.choice`;
 * scripts never see the API key. Failures return null (caller may fall back to LLM).
 */

import { askJev, choiceOf, noulOf, type AskJevFn } from '../client.js';
import type { JevChain } from '../settings.js';

const MAX_OPTIONS = 8;

export type JevPtcNoulResult = { value: boolean; p: number };
export type JevPtcChoiceResult = { value: string; p: number };

export interface PtcJevHooks {
  noul(instructions: string): Promise<JevPtcNoulResult | null>;
  choice(
    instructions: string,
    options: Record<string, string> | string[]
  ): Promise<JevPtcChoiceResult | null>;
}

/** Cap to 8 options; extras dropped. Returns ordered ids + optional labels for state. */
export function normalizePtcChoiceOptions(
  options: Record<string, string> | string[] | null | undefined
): { ids: string[]; labels: Record<string, string> } {
  if (options == null) return { ids: [], labels: {} };
  if (Array.isArray(options)) {
    const ids = options
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim())
      .slice(0, MAX_OPTIONS);
    const labels: Record<string, string> = Object.create(null);
    for (const id of ids) labels[id] = id;
    return { ids, labels };
  }
  if (typeof options !== 'object') return { ids: [], labels: {} };
  const ids: string[] = [];
  const labels: Record<string, string> = Object.create(null);
  for (const [key, label] of Object.entries(options)) {
    if (!key.trim()) continue;
    const id = key.trim();
    ids.push(id);
    labels[id] = typeof label === 'string' && label.trim() ? label.trim() : id;
    if (ids.length >= MAX_OPTIONS) break;
  }
  return { ids, labels };
}

export async function jevPtcNoul(
  chain: JevChain,
  instructions: string,
  signal?: AbortSignal,
  askFn: AskJevFn = askJev
): Promise<JevPtcNoulResult | null> {
  const text = typeof instructions === 'string' ? instructions.trim() : '';
  if (!text) return null;
  const answers = await askFn({
    chain,
    point: 'ptcDecide',
    state: text.slice(0, 8_000),
    nouls: [{ id: 'ptc_noul', instructions: text }],
    signal
  });
  const p = noulOf(answers, 'ptc_noul');
  if (p == null) return null;
  return { value: p >= 0.5, p };
}

export async function jevPtcChoice(
  chain: JevChain,
  instructions: string,
  options: Record<string, string> | string[],
  signal?: AbortSignal,
  askFn: AskJevFn = askJev
): Promise<JevPtcChoiceResult | null> {
  const text = typeof instructions === 'string' ? instructions.trim() : '';
  if (!text) return null;
  const { ids, labels } = normalizePtcChoiceOptions(options);
  if (ids.length < 2) return null;
  const allowed = new Set(ids);
  const answers = await askFn({
    chain,
    point: 'ptcDecide',
    state: `${text.slice(0, 6_000)}\n\nOptions:\n${ids
      .map((id) => `- ${id}: ${labels[id] ?? id}`)
      .join('\n')}`.slice(0, 8_000),
    choices: [
      {
        id: 'ptc_choice',
        instructions: text,
        options: ids
      }
    ],
    signal
  });
  const picked = choiceOf(answers, 'ptc_choice');
  if (!picked || !allowed.has(picked.choice)) return null;
  return { value: picked.choice, p: picked.confidence };
}

/** Build host `jev` bindings for a PTC cell. Chain must already include `ptcDecide`. */
export function createPtcJevHooks(
  chain: JevChain,
  signal?: AbortSignal,
  askFn: AskJevFn = askJev
): PtcJevHooks {
  return {
    noul: (instructions) => jevPtcNoul(chain, instructions, signal, askFn),
    choice: (instructions, options) => jevPtcChoice(chain, instructions, options, signal, askFn)
  };
}
