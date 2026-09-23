/**
 * Among existing saga/orchestration step options, decide whether to invoke the
 * deep LLM planner or pick an option id directly. Does not author plan text.
 */

import { askJev, choiceOf, noulOf, type AskJevFn } from '../client.js';
import type { JevChain } from '../settings.js';

const DECIDE_AT = 0.8;
const CHOICE_AT = 0.8;
const MAX_OPTIONS = 8;

export async function applyJevSagaGate(
  chain: JevChain,
  taskText: string,
  options: readonly { id: string; label: string }[],
  askFn: AskJevFn = askJev
): Promise<{ invokeLlm: boolean; optionId?: string } | null> {
  if (options.length < 2) return null;

  const capped = options.slice(0, MAX_OPTIONS);
  const allowed = new Set(capped.map((option) => option.id));

  const answers = await askFn({
    chain,
    point: 'sagaGate',
    state: `Task:\n${taskText.slice(0, 8_000)}\n\nOptions:\n${capped
      .map((option) => `- ${option.id}: ${option.label}`)
      .join('\n')}`,
    nouls: [
      {
        id: 'enough',
        instructions:
          'Are the existing discrete options already enough to decide the next step without asking an LLM to plan?'
      }
    ],
    choices: [
      {
        id: 'next',
        instructions:
          'If the discrete options are enough, choose the option id for the next saga/orchestration step. Candidates are only the listed ids.',
        options: capped.map((option) => option.id)
      }
    ]
  });
  if (!answers) return null;

  const enough = noulOf(answers, 'enough');
  const picked = choiceOf(answers, 'next');
  if (
    enough != null &&
    enough >= DECIDE_AT &&
    picked &&
    picked.confidence >= CHOICE_AT &&
    allowed.has(picked.choice)
  ) {
    return { invokeLlm: false, optionId: picked.choice };
  }

  return { invokeLlm: true };
}
