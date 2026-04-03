/**
 * Prompt builder: constructs the stable system prefix and dynamic per-turn context.
 *
 * Extracted from RawAgentRuntime to isolate system prompt construction from runtime orchestration.
 */

import { builtinSkills, loadAgentsDirSkills, loadWorkspaceSkills, mergeSkillsByName } from './builtin-skills.js';
import {
  buildSkillRouting,
  skillLoadStrictFromEnv,
  skillRoutingModeFromEnv,
  skillRoutingTopKFromEnv,
  type SkillRoutingResult,
} from './skill-router.js';
import type { SqliteStateStore } from './storage.js';
import { textSummaryFromParts } from './model-adapters.js';
import type {
  AgentSpec,
  SessionMessage,
  SessionRecord,
  SkillSpec,
  TaskRecord,
} from './types.js';

const { HARNESS_ARTIFACT_DIR, HARNESS_ARTIFACT_FILES } = await import('./types.js');

const MAX_MEMORY_ENTRIES = 20;

function envInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const v = Number(env[key]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

function capRollingSummaryText(text: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  return `…[earlier summary truncated]\n\n${text.slice(-maxChars)}`;
}

function compactSummaryMaxChars(env: NodeJS.ProcessEnv): number {
  const thr = envInt(env, 'RAW_AGENT_COMPACT_TOKEN_THRESHOLD', 24_000);
  return envInt(env, 'RAW_AGENT_COMPACT_SUMMARY_MAX_CHARS', thr * 2);
}

function textFromMessage(message: SessionMessage): string {
  return textSummaryFromParts(message.parts);
}

export interface PromptContext {
  agent: AgentSpec;
  session: SessionRecord;
  task?: TaskRecord;
  repoRoot: string;
  workspaceRoot?: string;
}

export interface PromptBuilderDeps {
  store: SqliteStateStore;
  repoRoot: string;
}

export class PromptBuilder {
  private workspaceSkillsPromise?: Promise<SkillSpec[]>;
  private readonly routingBySession = new Map<string, SkillRoutingResult>();
  /** Exposes last cognitive phase info by session (set externally by runtime). */
  lastCognitivePhaseBySession = new Map<string, { phase: string; confidence: number }>();

  constructor(private readonly deps: PromptBuilderDeps) {}

  /** Retrieve the latest routing result for a session (used by load_skill validation). */
  getRouting(sessionId: string): SkillRoutingResult | undefined {
    return this.routingBySession.get(sessionId);
  }

  /** Build the stable prefix (agent identity, repo root, workspace, mode). */
  buildStablePrefix(ctx: PromptContext): string {
    const harnessLines: string[] = [];
    if (ctx.agent.harnessRole === 'planner') {
      harnessLines.push(
        'Harness role: PLANNER — expand short goals into a high-level product spec and feature boundaries; avoid brittle low-level specs. Write product_spec.md via harness_write_spec.',
      );
    } else if (ctx.agent.harnessRole === 'generator') {
      harnessLines.push(
        'Harness role: GENERATOR — one sprint/feature at a time. Write sprint_contract.md (scope + verifiable acceptance criteria) before deep implementation; after work, prefer external review via spawn_subagent(role=evaluator) or role=review.',
      );
    } else if (ctx.agent.harnessRole === 'evaluator') {
      harnessLines.push(
        'Harness role: EVALUATOR — skeptical QA; probe edge cases; document findings in evaluator_feedback.md. Do not rubber-stamp generator output.',
      );
    }
    if (ctx.agent.id === 'main' || ctx.agent.capabilities.includes('orchestration')) {
      harnessLines.push(
        `Long-running harness: orchestrate planner → generator sprints → evaluator; structured files under ${HARNESS_ARTIFACT_DIR}/ (${HARNESS_ARTIFACT_FILES.productSpec}, ${HARNESS_ARTIFACT_FILES.sprintContract}, ${HARNESS_ARTIFACT_FILES.evaluatorFeedback}).`,
      );
    }

    return [
      `You are ${ctx.agent.name} (${ctx.agent.role}).`,
      ctx.agent.instructions,
      `Repository root: ${ctx.repoRoot}`,
      ctx.workspaceRoot ? `Workspace root: ${ctx.workspaceRoot}` : 'No isolated workspace bound.',
      `Conversation mode: ${ctx.session.mode}`,
      'You are running in a raw agent loop. Respond normally when no tools are needed.',
      'For multi-step work, call TodoWrite before broad execution and keep exactly one item in progress.',
      'Load skills from repo `skills/` and `~/.agents/**/SKILL.md` only when relevant with load_skill(name).',
      'Use persistent tasks for long-lived work and teammates only for clearly separable work.',
      'For large builds: load_skill(Long-running harness) and use harness_write_spec for cross-session handoffs.',
      'Use memory_set/memory_get for scratch and long-term notes; handoff_state copies scratch to subagents.',
      'When the user attaches images or you need OCR/visual detail from stored screenshots, call vision_analyze with asset_ids (from [image id] markers) and a focused prompt. Requires RAW_AGENT_VL_MODEL_NAME.',
      harnessLines.length > 0 ? harnessLines.join('\n') : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  /** Build the dynamic per-turn block (todos, task, memory, skills). */
  async buildDynamicContext(ctx: PromptContext, messages: SessionMessage[]): Promise<string> {
    const skills = await this.allSkills();
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const userText = textFromMessage(lastUser ?? { parts: [], role: 'user', id: '', sessionId: '', createdAt: '' });
    const mode = skillRoutingModeFromEnv(process.env);
    const topK = skillRoutingTopKFromEnv(process.env);
    const routing = buildSkillRouting(userText, skills, { mode, topK });
    this.routingBySession.set(ctx.session.id, routing);

    let skillBlock: string;
    if (routing.mode === 'legacy') {
      const skillLines = skills.map((s) => `- ${s.name}: ${s.description}`).join('\n');
      const matchedLines = routing.keywordMatched.map((s) => `- ${s.name}: ${s.promptFragment ?? s.description}`).join('\n');
      skillBlock = ['Available skills:', skillLines || '(none)', routing.keywordMatched.length > 0 ? `Matched guidance:\n${matchedLines}` : 'No matched guidance.'].join('\n\n');
    } else {
      const routedNames = new Set(routing.routed.map((r) => r.skill.name));
      const lines: string[] = [
        `Skill routing (${routing.mode}). Likely-relevant skills for this turn — call load_skill(name) for full SKILL.md:`,
        'Use exact skill names as shown.',
      ];
      if (routing.routed.length === 0 && routing.keywordMatched.length === 0) {
        lines.push('(no strong matches — rely on tools, or ask a clarifying question)');
      }
      if (routing.confidence.level === 'low') {
        lines.push(`⚠️ Routing confidence: ${routing.confidence.level}. ${routing.confidence.reason}`);
        lines.push('Consider asking a clarifying question to narrow intent before loading skills.');
      } else if (routing.confidence.level === 'medium' && routing.confidence.nearTopCount > 1) {
        lines.push(`ℹ️ Routing confidence: ${routing.confidence.level}. ${routing.confidence.reason}`);
      }
      for (const r of routing.routed) {
        lines.push(`- ${r.skill.name}: ${r.skill.description} [score=${r.score}; ${r.reason}]`);
      }
      for (const s of routing.keywordMatched) {
        if (routedNames.has(s.name)) continue;
        lines.push(`- ${s.name}: ${s.description} [keyword hint]`);
      }
      const strict = skillLoadStrictFromEnv(process.env);
      lines.push(
        strict
          ? 'Strict: only call load_skill for names listed above this turn.'
          : 'If you need a skill not listed, you may still call load_skill; off-shortlist loads are traced for routing quality.',
      );
      skillBlock = lines.join('\n');
    }

    const todoLine = ctx.session.todo.length > 0 ? JSON.stringify(ctx.session.todo) : 'No active todos.';
    const taskLine = ctx.task
      ? `Task: ${ctx.task.id} | ${ctx.task.title} | status=${ctx.task.status} | blockedBy=${ctx.task.blockedBy.join(', ') || 'none'}`
      : 'No bound task.';

    const cognitiveInfo = this.lastCognitivePhaseBySession.get(ctx.session.id);
    const cognitiveLine = cognitiveInfo
      ? `Session phase: ${cognitiveInfo.phase} (${(cognitiveInfo.confidence * 100).toFixed(0)}% confidence)`
      : '';

    const summaryMaxChars = compactSummaryMaxChars(process.env);
    const summaryLine = ctx.session.summary
      ? `Compressed summary:\n${capRollingSummaryText(ctx.session.summary, summaryMaxChars)}`
      : '';

    const mem = this.deps.store.listSessionMemory(ctx.session.id);
    const scratch = mem.filter((m) => m.scope === 'scratch').slice(0, MAX_MEMORY_ENTRIES);
    const longMem = mem.filter((m) => m.scope === 'long').slice(0, MAX_MEMORY_ENTRIES);
    const scratchLine =
      scratch.length > 0 ? `Handoff scratch (key/value):\n${scratch.map((m) => `- ${m.key}: ${m.value}`).join('\n')}` : 'Handoff scratch: (empty)';
    const longLine =
      longMem.length > 0 ? `Long-term memory:\n${longMem.map((m) => `- ${m.key}: ${m.value}`).join('\n')}` : 'Long-term memory: (empty)';

    return [taskLine, `Todos: ${todoLine}`, cognitiveLine, summaryLine, scratchLine, longLine, skillBlock].filter(Boolean).join('\n\n');
  }

  /** Full system prompt = stable prefix + dynamic context. */
  async buildSystemPrompt(ctx: PromptContext, messages: SessionMessage[]): Promise<string> {
    const stablePrefix = this.buildStablePrefix(ctx);
    const dynamicContext = await this.buildDynamicContext(ctx, messages);
    return [stablePrefix, dynamicContext].filter(Boolean).join('\n\n---\n\n');
  }

  async allSkills(): Promise<SkillSpec[]> {
    if (!this.workspaceSkillsPromise) {
      this.workspaceSkillsPromise = (async () => {
        const [ws, ag] = await Promise.all([loadWorkspaceSkills(this.deps.repoRoot), loadAgentsDirSkills()]);
        return mergeSkillsByName(ws, ag);
      })();
    }
    const merged = await this.workspaceSkillsPromise;
    return [...builtinSkills, ...merged];
  }

  /** Reset cached workspace skills (e.g. after runtime reloads them). */
  invalidateSkillsCache(): void {
    this.workspaceSkillsPromise = undefined;
  }
}
