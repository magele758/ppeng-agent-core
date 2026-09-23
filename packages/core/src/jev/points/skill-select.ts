/**
 * Soft skill shortlist via Jev.
 *
 * Callers should lexical-shortlist first. When there are more than 8 candidates,
 * only the first 8 are asked; names beyond that window are kept as-is (never
 * dropped by this step).
 */

import { askJev, noulOf, type AskJevFn } from '../client.js';
import type { JevChain } from '../settings.js';

const KEEP_AT = 0.45;
const ASK_CAP = 8;

export async function applyJevSkillSelect(
  chain: JevChain,
  taskText: string,
  skills: ReadonlyArray<{ name: string; description?: string }>,
  askFn: AskJevFn = askJev
): Promise<string[] | null> {
  if (skills.length < 2) return null;

  const ask = skills.slice(0, ASK_CAP);
  const restNames = skills.slice(ASK_CAP).map((skill) => skill.name);

  const answers = await askFn({
    chain,
    point: 'skillSelect',
    state: [
      `Task:\n${taskText}`,
      '',
      'Skill candidates:',
      ...ask.map(
        (skill, i) =>
          `[#${i}] ${skill.name}${skill.description ? `: ${skill.description}` : ''}`
      )
    ].join('\n'),
    nouls: ask.map((skill, i) => ({
      id: `s${i}`,
      instructions: `当前任务是否需要这个技能：${skill.name}？`
    }))
  });
  if (!answers) return null;

  const keptFromAsk: string[] = [];
  ask.forEach((skill, i) => {
    const p = noulOf(answers, `s${i}`);
    if (p != null && p >= KEEP_AT) keptFromAsk.push(skill.name);
  });

  // Fail-open: never empty the skill set when nothing cleared the threshold.
  if (keptFromAsk.length === 0) return null;

  const keep = new Set([...keptFromAsk, ...restNames]);
  const allowed = new Set(skills.map((skill) => skill.name));
  return skills.map((skill) => skill.name).filter((name) => keep.has(name) && allowed.has(name));
}
