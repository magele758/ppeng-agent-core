/**
 * Pick one recovery action via Choice. Low confidence ⇒ null (caller keeps hardcoded path).
 */

import { askJev, choiceOf, type AskJevFn } from '../client.js';
import type { JevChain } from '../settings.js';

const ACT_AT = 0.65;
const MAX_OPTIONS = 8;

export async function applyJevRecoveryChoice(
  chain: JevChain,
  situation: string,
  options: readonly { id: string; label: string }[],
  askFn: AskJevFn = askJev
): Promise<string | null> {
  if (options.length < 2) return null;

  const capped = options.slice(0, MAX_OPTIONS);
  const allowed = new Set(capped.map((option) => option.id));

  const answers = await askFn({
    chain,
    point: 'recoveryChoice',
    state: `Situation:\n${situation.slice(0, 8_000)}\n\nOptions:\n${capped
      .map((option) => `- ${option.id}: ${option.label}`)
      .join('\n')}`,
    choices: [
      {
        id: 'recovery',
        instructions: 'Choose the best recovery action id for this situation.',
        options: capped.map((option) => option.id)
      }
    ]
  });

  const picked = choiceOf(answers, 'recovery');
  if (!picked || picked.confidence < ACT_AT) return null;
  if (!allowed.has(picked.choice)) return null;
  return picked.choice;
}
