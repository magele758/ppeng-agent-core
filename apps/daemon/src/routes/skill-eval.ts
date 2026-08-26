import {
  runSkillEval,
  compareSkillEvalModes,
  generateSyntheticTestCases,
  loadAllSkills,
  type RawAgentRuntime,
  type SkillRoutingMode
} from '@ppeng/agent-core';
import type { RouteSpec } from '../routing.js';
import { json } from '../http-utils.js';

export function skillEvalRoutes(runtime: RawAgentRuntime): RouteSpec[] {
  return [
    {
      method: 'POST',
      pattern: '/api/eval/skills/run',
      handler: async ({ readBody, response }) => {
        try {
          const body = ((await readBody()) ?? {}) as Record<string, unknown>;

          const mode = (body.mode as SkillRoutingMode) ?? 'hybrid';
          const topK = body.topK ? Number(body.topK) : 5;
          const useFusion = Boolean(body.useFusion);

          const summary = await runSkillEval({
            mode,
            topK,
            useFusion,
            skills: await loadAllSkills(runtime.repoRoot)
          });

          return json(response, 200, { ok: true, summary });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return json(response, 500, { ok: false, error: message });
        }
      }
    },
    {
      method: 'POST',
      pattern: '/api/eval/skills/compare',
      handler: async ({ readBody, response }) => {
        try {
          const body = ((await readBody()) ?? {}) as Record<string, unknown>;

          const modes = Array.isArray(body.modes)
            ? (body.modes as SkillRoutingMode[])
            : (['legacy', 'lexical', 'hybrid'] as SkillRoutingMode[]);
          const topK = body.topK ? Number(body.topK) : 5;

          const result = await compareSkillEvalModes({
            modes,
            topK,
            skills: await loadAllSkills(runtime.repoRoot)
          });

          return json(response, 200, { ok: true, result });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return json(response, 500, { ok: false, error: message });
        }
      }
    },
    {
      method: 'GET',
      pattern: '/api/eval/skills/synthetic-cases',
      handler: async ({ response }) => {
        try {
          const skills = await loadAllSkills(runtime.repoRoot);
          const syntheticCases = generateSyntheticTestCases(skills);
          return json(response, 200, { ok: true, count: syntheticCases.length, cases: syntheticCases });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return json(response, 500, { ok: false, error: message });
        }
      }
    }
  ];
}
