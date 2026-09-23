/**
 * Soft tool shortlist via Jev.
 *
 * Callers should lexical-shortlist first. When there are more than 8 candidates,
 * only the first 8 are asked; names beyond that window are kept as-is (never
 * dropped by this step).
 */

import { askJev, noulOf, type AskJevFn } from '../client.js';
import type { JevChain } from '../settings.js';

const KEEP_AT = 0.45;
const ASK_CAP = 8;

export async function applyJevToolSelect(
  chain: JevChain,
  taskText: string,
  tools: ReadonlyArray<{ name: string; description?: string }>,
  askFn: AskJevFn = askJev
): Promise<string[] | null> {
  if (tools.length < 2) return null;

  const ask = tools.slice(0, ASK_CAP);
  const restNames = tools.slice(ASK_CAP).map((tool) => tool.name);

  const answers = await askFn({
    chain,
    state: [
      `Task:\n${taskText}`,
      '',
      'Tool candidates:',
      ...ask.map(
        (tool, i) =>
          `[#${i}] ${tool.name}${tool.description ? `: ${tool.description}` : ''}`
      )
    ].join('\n'),
    nouls: ask.map((tool, i) => ({
      id: `t${i}`,
      instructions: `当前任务是否需要这个工具：${tool.name}？`
    }))
  });
  if (!answers) return null;

  const keptFromAsk: string[] = [];
  ask.forEach((tool, i) => {
    const p = noulOf(answers, `t${i}`);
    if (p != null && p >= KEEP_AT) keptFromAsk.push(tool.name);
  });

  // Fail-open: never empty the tool set when nothing cleared the threshold.
  if (keptFromAsk.length === 0) return null;

  const keep = new Set([...keptFromAsk, ...restNames]);
  const allowed = new Set(tools.map((tool) => tool.name));
  return tools.map((tool) => tool.name).filter((name) => keep.has(name) && allowed.has(name));
}
