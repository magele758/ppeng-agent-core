#!/usr/bin/env node
/**
 * Unified Coding-Agent adapter for FixCandidate loops.
 * Priority: EVOLUTION_CODING_AGENT -> EVOLUTION_AGENT_CMD -> self-heal style noop.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizeScriptEnv } from '../spawn-utils.mjs';

function codingEnv() {
  const base = sanitizeScriptEnv(process.env);
  const map = [
    ['EVOLUTION_CODING_BASE_URL', 'RAW_AGENT_BASE_URL'],
    ['EVOLUTION_CODING_API_KEY', 'RAW_AGENT_API_KEY'],
    ['EVOLUTION_CODING_MODEL_NAME', 'RAW_AGENT_MODEL_NAME']
  ];
  for (const [codingKey, rawKey] of map) {
    if (base[codingKey]) continue;
    if (base[rawKey]) base[codingKey] = base[rawKey];
  }
  return base;
}

export function runCodingAgent({ repoRoot, task, worktreeDir }) {
  const agent = (process.env.EVOLUTION_CODING_AGENT ?? 'cmd').trim().toLowerCase();
  const cwd = worktreeDir || repoRoot;
  const env = codingEnv();
  const prompt = task || 'Fix failing release gates with minimal diff; run tests.';

  if (agent === 'cmd' || agent === 'claude-code' || agent === 'codex' || agent === 'pi') {
    const hook = process.env.EVOLUTION_AGENT_CMD?.trim();
    if (hook) {
      const r = spawnSync('bash', ['-lc', hook], {
        cwd,
        env: { ...env, EVOLUTION_CODING_TASK: prompt, EVOLUTION_CODING_WORKTREE: cwd },
        encoding: 'utf8'
      });
      return {
        ok: r.status === 0,
        agent: 'cmd',
        detail: (r.stderr || r.stdout || '').slice(-4000)
      };
    }
  }

  if (agent === 'claude-code') {
    const script = join(repoRoot, 'scripts', 'ai-cli', 'claude-code.sh');
    if (existsSync(script)) {
      const r = spawnSync('bash', [script, prompt], { cwd, env, encoding: 'utf8' });
      return { ok: r.status === 0, agent: 'claude-code', detail: (r.stderr || r.stdout || '').slice(-4000) };
    }
  }

  return { ok: false, agent, detail: 'No coding agent configured (set EVOLUTION_AGENT_CMD or EVOLUTION_CODING_AGENT)' };
}
