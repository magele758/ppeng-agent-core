/**
 * Skill load_skill resolver extracted from RawAgentRuntime.
 */

import { envBool } from '../env.js';
import type { PromptBuilder } from '../model/prompt-builder.js';
import { skillLoadStrictFromEnv, skillRoutingModeFromEnv } from '../skills/skill-router.js';
import { discloseSkillBody, formatDisclosedSkillContent } from '../skills/skill-disclosure.js';
import type { TraceEvent } from '../stores/trace.js';

export interface SkillLoadHost {
  promptBuilder: PromptBuilder;
  emitTrace(sessionId: string, event: Omit<TraceEvent, 'ts' | 'sessionId'>): void;
}

export async function resolveSkillLoad(
  host: SkillLoadHost,
  name: string,
  sessionId: string
): Promise<{ content?: string; error?: string }> {
  const skills = await host.promptBuilder.allSkills();
  const normalizedName = name.trim().toLowerCase();
  const found = skills.find((skill) => {
    const lookupKeys = [skill.name, skill.id, ...(skill.aliases ?? [])];
    return lookupKeys.some((candidate) => candidate.trim().toLowerCase() === normalizedName);
  });
  if (!found?.content) {
    return { error: `Skill "${name}" not found.` };
  }

  const mode = skillRoutingModeFromEnv(process.env);
  const routing = host.promptBuilder.getRouting(sessionId);
  const shortlist = new Set(routing?.shortlistNames ?? []);

  const inShortlist = mode === 'legacy' || !routing
    ? true
    : shortlist.has(found.name) || shortlist.has(found.id);
  const isStrict = mode !== 'legacy' && skillLoadStrictFromEnv(process.env);

  if (isStrict && !inShortlist) {
    const suggestions = routing?.routed.slice(0, 3).map(r => r.skill.name).join(', ');
    void host.emitTrace(sessionId, {
      kind: 'skill_load',
      payload: { name, skillId: found.id, skillName: found.name, inShortlist: false, rejected: true, reason: 'strict_off_shortlist', confidence: routing?.confidence.level }
    });
    return { error: `Skill "${found.name}" is not in the current turn's shortlist. Strict mode is ON. Try one of these: ${suggestions || 'none suggested'}` };
  }

  void host.emitTrace(sessionId, {
    kind: 'skill_load',
    payload: { name, skillId: found.id, skillName: found.name, inShortlist, rejected: false, override: !inShortlist && mode !== 'legacy', confidence: routing?.confidence.level }
  });
  const progressive = envBool(process.env, 'RAW_AGENT_SKILL_PROGRESSIVE', true);
  const disclosed = discloseSkillBody(found.content, { progressive });
  return { content: formatDisclosedSkillContent(disclosed) };
}
