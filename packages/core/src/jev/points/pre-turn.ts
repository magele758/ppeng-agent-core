/**
 * Pre-turn soft skip: only when a structured goal exists.
 * No goal ⇒ always call the deep model (never skip without a reply path).
 */

import { askJev, noulOf, type AskJevFn } from '../client.js';
import type { JevChain } from '../settings.js';

const SKIP_AT = 0.8;

export async function applyJevPreTurn(
  chain: JevChain,
  taskText: string,
  hasGoal: boolean,
  askFn: AskJevFn = askJev
): Promise<'call_model' | 'skip_done' | null> {
  if (!hasGoal) return 'call_model';

  const answers = await askFn({
    chain,
    state: taskText.slice(0, 12_000),
    nouls: [
      {
        id: 'met',
        instructions: '目标条件是否已经满足'
      }
    ]
  });
  if (!answers) return null;

  const p = noulOf(answers, 'met');
  if (p == null) return null;
  return p >= SKIP_AT ? 'skip_done' : 'call_model';
}
