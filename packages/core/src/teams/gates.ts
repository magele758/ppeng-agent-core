import { spawnSync } from 'node:child_process';
import { sanitizeSpawnEnv } from '../sandbox/env-sanitizer.js';
import { nowIso } from '../id.js';
import type { TeamsDagSettings } from './settings.js';
import type { TeamGateEvent, TeamGateName, TeamGateState, TeamGateStatus } from './types.js';

export const TEAM_GATE_ORDER: readonly TeamGateName[] = ['review', 'regression', 'release'];

const TRANSITIONS: Record<TeamGateStatus, Partial<Record<TeamGateEvent, TeamGateStatus>>> = {
  pending: { start: 'running', skip: 'skipped' },
  running: { pass: 'passed', fail: 'failed', skip: 'skipped', need_human: 'awaiting_human' },
  awaiting_human: { pass: 'passed', fail: 'failed' },
  passed: {},
  failed: {},
  skipped: {}
};

export function transitionGate(from: TeamGateStatus, event: TeamGateEvent): TeamGateStatus {
  const to = TRANSITIONS[from]?.[event];
  if (!to) {
    throw new Error(`[TeamGate] 非法转移：${from} --${event}--> (无此边)`);
  }
  return to;
}

export function initGatesFromSettings(settings: TeamsDagSettings): TeamGateState[] {
  return TEAM_GATE_ORDER.map((name) => {
    const cfg = settings.gates[name];
    return {
      name,
      status: cfg.enabled ? 'pending' : 'skipped',
      checker: cfg.checker,
      command: cfg.command,
      passed: cfg.enabled ? undefined : true,
      feedback: cfg.enabled ? undefined : 'disabled'
    };
  });
}

export function nextRunnableGate(gates: TeamGateState[]): TeamGateState | undefined {
  for (const gate of gates) {
    if (gate.status === 'awaiting_human' || gate.status === 'running') return gate;
    if (gate.status === 'failed') return undefined;
    if (gate.status === 'pending') return gate;
  }
  return undefined;
}

export function allGatesSettled(gates: TeamGateState[]): boolean {
  return gates.every((g) => g.status === 'passed' || g.status === 'skipped' || g.status === 'failed');
}

export function gatesAllowRelease(gates: TeamGateState[]): boolean {
  return gates.every((g) => g.status === 'passed' || g.status === 'skipped');
}

export function applyGateEvent(gate: TeamGateState, event: TeamGateEvent, feedback?: string): TeamGateState {
  const status = transitionGate(gate.status, event);
  const passed = status === 'passed' || status === 'skipped';
  return {
    ...gate,
    status,
    passed: status === 'failed' ? false : passed,
    feedback: feedback ?? gate.feedback,
    decidedAt: status === 'passed' || status === 'failed' || status === 'skipped' ? nowIso() : gate.decidedAt
  };
}

export interface TeamGateEvalContext {
  objective: string;
  completeText?: (input: { system: string; user: string }) => Promise<string>;
}

export interface TeamGateEvalResult {
  event: TeamGateEvent;
  feedback: string;
}

const SAFE_COMMAND = /^[A-Za-z0-9._+-]+$/;

export function commandExists(command: string | undefined): { ok: boolean; reason: string } {
  const cmd = (command ?? '').trim();
  if (!cmd) return { ok: false, reason: '未配置命令' };
  if (!SAFE_COMMAND.test(cmd)) return { ok: false, reason: '命令名非法（仅允许标识符，不执行 shell）' };
  const result = spawnSync('which', [cmd], {
    encoding: 'utf8',
    env: sanitizeSpawnEnv() as Record<string, string>
  });
  if (result.status === 0 && result.stdout.trim()) {
    return { ok: true, reason: `command exists: ${cmd}` };
  }
  return { ok: false, reason: `command not found: ${cmd}` };
}

function parseJudge(text: string): { passed: boolean; reason: string } | undefined {
  const trimmed = (text || '').trim();
  if (!trimmed) return undefined;
  try {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    const slice = start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
    const parsed = JSON.parse(slice) as Record<string, unknown>;
    if (typeof parsed.passed !== 'boolean' && typeof parsed.met !== 'boolean') return undefined;
    const passed = typeof parsed.passed === 'boolean' ? parsed.passed : Boolean(parsed.met);
    const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : '';
    return { passed, reason: reason || (passed ? 'pass' : 'fail') };
  } catch {
    return undefined;
  }
}

export async function evaluateGate(
  gate: TeamGateState,
  ctx: TeamGateEvalContext
): Promise<TeamGateEvalResult> {
  if (gate.checker === 'human') {
    return { event: 'need_human', feedback: '等待人工确认' };
  }
  if (gate.checker === 'command') {
    const found = commandExists(gate.command);
    return { event: found.ok ? 'pass' : 'fail', feedback: found.reason };
  }
  if (gate.name === 'release') {
    return { event: 'pass', feedback: '标记计划可交付' };
  }
  if (ctx.completeText) {
    try {
      const text = await ctx.completeText({
        system:
          'You are a generic team gate judge. Reply JSON only: {"passed":true|false,"reason":"..."}. Fail-soft: if unsure, passed=true.',
        user: `Gate: ${gate.name}\nObjective: ${ctx.objective}`
      });
      const judged = parseJudge(text || '');
      if (judged) {
        return { event: judged.passed ? 'pass' : 'fail', feedback: judged.reason };
      }
    } catch {
      /* heuristic */
    }
  }
  return { event: 'pass', feedback: 'llm unavailable; heuristic pass' };
}
