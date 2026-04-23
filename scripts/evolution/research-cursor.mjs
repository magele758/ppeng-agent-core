#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { parseResearchDecisionOutput } from './research-gate.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dir, '..', '..');

function writeDecisionFile(path, parsed) {
  const lines = [parsed.decision];
  if (parsed.decision === 'SKIP' && parsed.skipType) lines.push(parsed.skipType);
  if (parsed.reason) lines.push(parsed.reason.trim());
  writeFileSync(path, lines.join('\n') + '\n', 'utf8');
}

function runCommand(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    let err = '';
    child.stdout?.on('data', (chunk) => { out += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { err += chunk.toString(); });
    child.on('close', (code) => resolve({ code: code ?? 1, out, err }));
    child.on('error', reject);
  });
}

function runAgent(prompt, wt, model) {
  return runCommand('agent', ['--print', '--yolo', '--model', model, prompt], wt);
}

async function main() {
  const wt = process.env.EVOLUTION_WORKTREE || process.cwd();
  const excerptFile = process.env.EVOLUTION_SOURCE_EXCERPT_FILE || '';
  const constraintsFile = process.env.EVOLUTION_AGENT_CONSTRAINTS_FILE || '';
  const decisionFile = process.env.EVOLUTION_RESEARCH_DECISION_FILE || join(wt, '.evolution', 'research-decision.txt');
  const sourceUrl = process.env.EVOLUTION_SOURCE_URL || '';
  const cursorModel = process.env.EVOLUTION_CURSOR_AGENT_MODEL || 'composer-2-fast';

  mkdirSync(dirname(decisionFile), { recursive: true });

  const excerptText = excerptFile && existsSync(excerptFile) ? readFileSync(excerptFile, 'utf8').trim() : '';
  const constraintsText = constraintsFile && existsSync(constraintsFile) ? readFileSync(constraintsFile, 'utf8').trim() : '';

  let arxivContent = '';
  if (sourceUrl.includes('arxiv.org')) {
    try {
      const fetchRes = await runCommand('node', [join(repoRoot, 'scripts', 'arxiv-fetch.mjs'), sourceUrl], wt);
      const { title, abstract } = JSON.parse(fetchRes.out.trim() || '{}');
      if (title && abstract) {
        arxivContent = `\n\n## arXiv\n**标题:** ${title}\n\n### Abstract\n${abstract}\n`;
      }
    } catch {
      // Fallback below.
    }
  }

  const hasUsableExcerpt = Boolean(excerptText || arxivContent);
  if (!hasUsableExcerpt) {
    const parsed = parseResearchDecisionOutput('', { hasUsableExcerpt: false });
    writeDecisionFile(decisionFile, parsed);
    console.error('evolution-research-cursor: 缺少可用 excerpt，直接 SKIP');
    return;
  }

  if (!process.env.PATH || !process.env.PATH.includes('/bin')) {
    process.env.PATH = `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`;
  }

  const agentExists = await runCommand('sh', ['-c', 'command -v agent >/dev/null 2>&1'], wt).catch(() => ({ code: 1 }));
  if (agentExists.code !== 0) {
    writeDecisionFile(decisionFile, {
      decision: 'PROCEED',
      skipType: '',
      reason: '无 cursor agent CLI，默认继续。'
    });
    console.error('evolution-research-cursor: 未找到 cursor agent，默认 PROCEED');
    return;
  }

  const prompt =
    `You are a senior architect evaluating whether a source article offers a REAL, IMPLEMENTABLE\n` +
    `capability improvement for a TypeScript/Node.js multi-agent runtime repository at: ${wt}\n\n` +
    `The repo provides: multi-agent runtime (sessions/tools/MCP), Capability Gateway (HTTP/SSE/RSS learn),\n` +
    `Web console (Next.js), Self-heal subsystem (autonomous test-fix-merge).\n\n` +
    `Read the source excerpt and compare against the current codebase. Output EXACTLY in this format:\n\n` +
    `For a valuable NEW improvement:\n` +
    `  PROCEED\n` +
    `  <which file/function to change and why>\n\n` +
    `For SKIP, use one category:\n` +
    `  SKIP: SUPERSEDED   — current implementation is already better\n` +
    `  SKIP: DUPLICATE    — already implemented equivalently\n` +
    `  SKIP: IRRELEVANT   — not applicable to this codebase\n` +
    `  SKIP: OUTDATED     — article describes deprecated approach\n` +
    `  SKIP: TOO_COMPLEX  — would require major refactor\n\n` +
    `Be VERY SELECTIVE. Most articles should be SKIP.` +
    (constraintsText ? `\n\n## Project Constraints\n${constraintsText}\n` : '') +
    (excerptText ? `\n\n## Source Excerpt\n${excerptText}\n` : '') +
    arxivContent;

  console.error(`evolution-research-cursor: 使用 cursor agent --model ${cursorModel}`);
  const res = await runAgent(prompt, wt, cursorModel).catch((error) => ({
    code: 1,
    out: '',
    err: error instanceof Error ? error.message : String(error)
  }));
  const output = `${res.out}${res.err ? `\n${res.err}` : ''}`.trim();
  let parsed = parseResearchDecisionOutput(output, { hasUsableExcerpt: true });
  if (res.code !== 0 && parsed.decision === 'PROCEED') {
    parsed = {
      decision: 'SKIP',
      skipType: 'OUTDATED',
      reason: `research command exited ${res.code}: ${output.split('\n').slice(0, 4).join('\n')}`.trim()
    };
  }
  writeDecisionFile(decisionFile, parsed);
  console.error(`evolution-research-cursor: 决策=${parsed.decision}${parsed.skipType ? ` (${parsed.skipType})` : ''}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`evolution-research-cursor: ${message}`);
  process.exitCode = 1;
});
