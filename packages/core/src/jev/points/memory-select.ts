/**
 * Filter memory candidates by per-item Noul relevance.
 * Head items beyond the last-8 window are kept as-is; empty filter ⇒ null.
 */

import { askJev, noulOf, type AskJevFn } from '../client.js';
import type { JevChain } from '../settings.js';

const RELATE_AT = 0.4;
const MAX_ASK = 8;

export async function applyJevMemorySelect(
  chain: JevChain,
  taskText: string,
  items: readonly { id: string; text: string }[],
  askFn: AskJevFn = askJev
): Promise<string[] | null> {
  if (items.length < 2) return null;

  const askStart = Math.max(0, items.length - MAX_ASK);
  const head = items.slice(0, askStart);
  const ask = items.slice(askStart);

  const answers = await askFn({
    chain,
    point: 'memorySelect',
    state: `Task:\n${taskText.slice(0, 4_000)}\n\nCandidates:\n${ask
      .map((item, i) => `[#${i}] id=${item.id}\n${item.text.slice(0, 800)}`)
      .join('\n\n')}`,
    nouls: ask.map((_, i) => ({
      id: `m${i}`,
      instructions: '与当前任务相关吗'
    }))
  });
  if (!answers) return null;

  const keptAsk: string[] = [];
  for (let i = 0; i < ask.length; i++) {
    const p = noulOf(answers, `m${i}`);
    if (p != null && p >= RELATE_AT) keptAsk.push(ask[i]!.id);
  }
  if (keptAsk.length === 0) return null;

  const allowed = new Set(items.map((item) => item.id));
  const out = [...head.map((item) => item.id), ...keptAsk].filter((id) => allowed.has(id));
  return out.length > 0 ? out : null;
}
