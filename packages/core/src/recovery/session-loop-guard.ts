import { createHash } from 'node:crypto';
import type { MessagePart } from '../types.js';
import { envBool, envInt } from '../env.js';

export function recoveryPolicyEnabled(env: NodeJS.ProcessEnv): boolean {
  return envBool(env, 'RAW_AGENT_RECOVERY_POLICY', true);
}

function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => sortKeysDeep(item));
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce(
      (acc, key) => {
        acc[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        return acc;
      },
      {} as Record<string, unknown>
    );
}

function fingerprintAssistant(parts: MessagePart[]): string {
  const chunks: string[] = [];
  for (const p of parts) {
    if (p.type === 'text') chunks.push(`t:${p.text}`);
    else if (p.type === 'reasoning') chunks.push(`r:${p.text}`);
    else if (p.type === 'tool_call') {
      chunks.push(`c:${p.name}:${stableJsonForFingerprint(p.input)}`);
    }
  }
  return createHash('sha256').update(chunks.join('\n')).digest('hex').slice(0, 32);
}

function stableJsonForFingerprint(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(sortKeysDeep(input));
  } catch {
    return String(input);
  }
}

function repeatRatioFromEnv(env: NodeJS.ProcessEnv): number {
  const raw = Number(env.RAW_AGENT_RECOVERY_REPEAT_RATIO);
  if (!Number.isFinite(raw)) return 0.75;
  return Math.min(1, Math.max(0.5, raw));
}

/**
 * Per-session loop detection: tool failure streaks, same-tool streak across turns,
 * repeated assistant fingerprints (cheap dead-loop signal).
 */
export class SessionLoopGuard {
  private readonly toolFailStreak = new Map<string, number>();
  private readonly sameToolHistory: string[] = [];
  private readonly contentHashes: string[] = [];

  private readonly failStreakMax: number;
  private readonly sameToolStreakMax: number;
  private readonly repeatWindow: number;
  private readonly repeatRatio: number;

  constructor(env: NodeJS.ProcessEnv) {
    this.failStreakMax = envInt(env, 'RAW_AGENT_RECOVERY_TOOL_FAIL_STREAK', 3);
    this.sameToolStreakMax = envInt(env, 'RAW_AGENT_RECOVERY_SAME_TOOL_STREAK', 5);
    this.repeatWindow = envInt(env, 'RAW_AGENT_RECOVERY_REPEAT_WINDOW', 8);
    this.repeatRatio = repeatRatioFromEnv(env);
  }

  /** After model returns; updates repetition window. */
  checkAssistantRepetition(assistantParts: MessagePart[]): { abort: true; reason: string } | { abort: false } {
    const fp = fingerprintAssistant(assistantParts);
    this.contentHashes.push(fp);
    if (this.contentHashes.length > this.repeatWindow) {
      this.contentHashes.shift();
    }
    const counts = new Map<string, number>();
    for (const h of this.contentHashes) {
      counts.set(h, (counts.get(h) ?? 0) + 1);
    }
    let maxC = 0;
    for (const c of counts.values()) {
      maxC = Math.max(maxC, c);
    }
    const n = this.contentHashes.length;
    const ratio = n > 0 ? maxC / n : 0;
    if (n >= 4 && ratio >= this.repeatRatio) {
      return {
        abort: true,
        reason: `repeated model output (${(ratio * 100).toFixed(0)}% identical fingerprint in last ${n} turns)`
      };
    }
    return { abort: false };
  }

  /** After tool results are known; updates failure and same-tool streaks. */
  afterToolRound(
    toolCalls: { name: string }[],
    results: { name: string; ok: boolean }[]
  ): { abort: true; reason: string } | { abort: false } {
    for (const r of results) {
      if (!r.ok) {
        this.toolFailStreak.set(r.name, (this.toolFailStreak.get(r.name) ?? 0) + 1);
      } else {
        this.toolFailStreak.set(r.name, 0);
      }
    }
    for (const [name, streak] of this.toolFailStreak) {
      if (streak >= this.failStreakMax) {
        return { abort: true, reason: `tool "${name}" failed ${streak} times in a row` };
      }
    }

    const first = toolCalls[0]?.name;
    if (first) {
      this.sameToolHistory.push(first);
      if (this.sameToolHistory.length > this.sameToolStreakMax) {
        this.sameToolHistory.shift();
      }
      if (this.sameToolHistory.length >= this.sameToolStreakMax) {
        const uniq = new Set(this.sameToolHistory);
        if (uniq.size === 1) {
          return {
            abort: true,
            reason: `first tool "${first}" in ${this.sameToolStreakMax} consecutive tool rounds`
          };
        }
      }
    }
    return { abort: false };
  }
}
