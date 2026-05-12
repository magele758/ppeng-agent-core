#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { buildResearchEvaluationPrompt } from './research-eval-prompt.mjs';
import {
  computeSourceAvailability,
  parseResearchDecisionOutput,
  writeResearchDecisionFile
} from './research-gate.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dir, '..', '..');

function runCommand(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    let err = '';
    child.stdout?.on('data', (chunk) => {
      out += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      err += chunk.toString();
    });
    child.on('close', (code) => resolve({ code: code ?? 1, out, err }));
    child.on('error', reject);
  });
}

function runAgent(prompt, wt, model) {
  return runCommand('agent', ['--print', '--yolo', '--model', model, prompt], wt);
}

function unparsedFromEnv() {
  return (process.env.EVOLUTION_RESEARCH_UNPARSED_DEFAULT || 'proceed').toLowerCase() === 'skip' ? 'skip' : 'proceed';
}

async function main() {
  const wt = process.env.EVOLUTION_WORKTREE || process.cwd();
  const excerptFile = process.env.EVOLUTION_SOURCE_EXCERPT_FILE || '';
  const constraintsFile = process.env.EVOLUTION_AGENT_CONSTRAINTS_FILE || '';
  const decisionFile = process.env.EVOLUTION_RESEARCH_DECISION_FILE || join(wt, '.evolution', 'research-decision.txt');
  const sourceUrl = (process.env.EVOLUTION_SOURCE_URL || '').trim();
  const sourceTitle = (process.env.EVOLUTION_SOURCE_TITLE || '').trim();
  const fetchNote = (process.env.EVOLUTION_SOURCE_FETCH_NOTE || '').trim();
  const cursorModel = process.env.EVOLUTION_CURSOR_AGENT_MODEL || 'composer-2-fast';
  const minFull = Math.max(
    120,
    Number.parseInt(String(process.env.EVOLUTION_RESEARCH_FULL_EXCERPT_MIN_CHARS || '500'), 10) || 500
  );

  mkdirSync(dirname(decisionFile), { recursive: true });

  const excerptText = excerptFile && existsSync(excerptFile) ? readFileSync(excerptFile, 'utf8').trim() : '';
  const constraintsText =
    constraintsFile && existsSync(constraintsFile) ? readFileSync(constraintsFile, 'utf8').trim() : '';

  let arxivContent = '';
  if (sourceUrl.includes('arxiv.org')) {
    try {
      const fetchRes = await runCommand('node', [join(repoRoot, 'scripts', 'arxiv-fetch.mjs'), sourceUrl], wt);
      const { title, abstract } = JSON.parse(fetchRes.out.trim() || '{}');
      if (title && abstract) {
        arxivContent = `\n\n## arXiv\n**标题:** ${title}\n\n### Abstract\n${abstract}\n`;
      }
    } catch {
      /* ignore */
    }
  }

  const availability = computeSourceAvailability({
    excerptText,
    sourceTitle,
    sourceUrl,
    hasArxivBlock: Boolean(arxivContent),
    minFullChars: minFull
  });

  if (availability === 'none') {
    const parsed = parseResearchDecisionOutput('', { availability: 'none' });
    writeResearchDecisionFile(decisionFile, parsed);
    console.error('evolution-research-cursor: 无摘录/标题/URL，直接 SKIP');
    return;
  }

  if (!process.env.PATH || !process.env.PATH.includes('/bin')) {
    process.env.PATH = `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`;
  }

  const agentExists = await runCommand('sh', ['-c', 'command -v agent >/dev/null 2>&1'], wt).catch(() => ({ code: 1 }));
  if (agentExists.code !== 0) {
    writeResearchDecisionFile(decisionFile, {
      decision: 'PROCEED',
      skipType: '',
      reason: '无 cursor agent CLI，默认继续。'
    });
    console.error('evolution-research-cursor: 未找到 cursor agent，默认 PROCEED');
    return;
  }

  const strictness = (process.env.EVOLUTION_RESEARCH_STRICTNESS || 'balanced').trim().toLowerCase();
  const prompt = buildResearchEvaluationPrompt({
    worktreePath: wt,
    availability,
    strictness,
    constraintsText,
    excerptText,
    arxivContent,
    sourceTitle,
    sourceUrl,
    fetchNote
  });

  console.error(`evolution-research-cursor: 使用 cursor agent --model ${cursorModel}（source=${availability}）`);
  const res = await runAgent(prompt, wt, cursorModel).catch((error) => ({
    code: 1,
    out: '',
    err: error instanceof Error ? error.message : String(error)
  }));
  const output = `${res.out}${res.err ? `\n${res.err}` : ''}`.trim();
  let parsed = parseResearchDecisionOutput(output, {
    availability,
    unparsedDefault: unparsedFromEnv()
  });
  if (res.code !== 0 && parsed.decision === 'PROCEED') {
    parsed = {
      decision: 'SKIP',
      skipType: 'OUTDATED',
      reason: `research command exited ${res.code}: ${output.split('\n').slice(0, 4).join('\n')}`.trim()
    };
  }
  writeResearchDecisionFile(decisionFile, parsed);
  console.error(`evolution-research-cursor: 决策=${parsed.decision}${parsed.skipType ? ` (${parsed.skipType})` : ''}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`evolution-research-cursor: ${message}`);
  process.exitCode = 1;
});
