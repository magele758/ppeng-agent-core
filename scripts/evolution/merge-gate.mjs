#!/usr/bin/env node
/**
 * Merge gate module for Evolution 2.0.
 * Checks risk level and optional harness eval before allowing auto-merge.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assessRiskLevel } from './evolution-orchestrator-bridge.mjs';
import { utcDateString } from './inbox-loader.mjs';
import { truthy } from './process.mjs';

/**
 * Run the harness fast eval and return { code, out }.
 * Times out after 5 minutes.
 */
function runHarnessEval(repoRoot) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['scripts/agent-eval/runner.mjs', '--mode', 'fast', '--exit-on-fail'],
      { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let out = '';
    child.stdout?.on('data', (d) => { out += d.toString(); });
    child.stderr?.on('data', (d) => { out += d.toString(); });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ code: 1, out: out + '\n[merge-gate] harness eval timed out (5 min)' });
    }, 5 * 60 * 1_000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, out });
    });
    child.once('error', (e) => {
      clearTimeout(timer);
      resolve({ code: 1, out: e.message });
    });
  });
}

/**
 * Read risk_level from a result doc's YAML frontmatter.
 * Returns null if not found.
 */
function readRiskLevelFromDoc(docPath) {
  if (!docPath || !existsSync(docPath)) return null;
  try {
    const content = readFileSync(docPath, 'utf8');
    const m = /^risk_level:\s*(\S+)/m.exec(content);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * Check all merge gates before merging.
 *
 * @param {{
 *   riskLevel?: string,
 *   capabilityTags?: string[],
 *   worktreeDir?: string,
 *   resultDocPath?: string,
 *   daemonUrl?: string,
 *   repoRoot?: string,
 * }} opts
 * @returns {Promise<{ allowed: boolean, reason: string, action: 'merge'|'pr'|'backlog'|'skip', riskLevel?: string, failureType?: string }>}
 */
export async function checkMergeGate(opts = {}) {
  const { capabilityTags = [], resultDocPath, repoRoot = process.cwd() } = opts;

  // 1. Risk check
  if (truthy(process.env.EVOLUTION_MERGE_RISK_CHECK)) {
    let effectiveRisk = opts.riskLevel;
    if (!effectiveRisk) {
      effectiveRisk = readRiskLevelFromDoc(resultDocPath);
    }
    if (!effectiveRisk) {
      effectiveRisk = assessRiskLevel(capabilityTags);
    }

    if (effectiveRisk === 'high') {
      return {
        allowed: false,
        reason: `risk_level=high: security/auth/deployment/contract change requires manual review`,
        action: 'pr',
        riskLevel: effectiveRisk,
      };
    }
    if (effectiveRisk === 'medium') {
      console.warn(
        'evolution-merge-gate: WARNING risk_level=medium (runtime/web-console/domain-agents/cost-capacity) — auto-merging with caution'
      );
    }
  }

  // 2. Harness gate
  if (truthy(process.env.EVOLUTION_HARNESS_GATE)) {
    console.log('evolution-merge-gate: running harness fast eval before merge…');
    const { code, out } = await runHarnessEval(repoRoot);
    if (code !== 0) {
      console.error(`evolution-merge-gate: harness fast eval failed (exit ${code})\n${out.slice(-1000)}`);
      return {
        allowed: false,
        reason: `harness fast eval failed (exit ${code})`,
        action: 'skip',
        failureType: 'test_failed',
      };
    }
    console.log('evolution-merge-gate: harness fast eval passed');
  }

  return { allowed: true, reason: 'all gates passed', action: 'merge' };
}

/**
 * Write a backlog entry for items blocked from auto-merging.
 * Writes to doc/evolution/backlog/YYYY-MM-DD-{itemId}.md.
 *
 * @param {{ itemId?: string, id?: string, title?: string, url?: string, link?: string, riskLevel?: string, capabilityTags?: string[] }} item
 * @param {string} reason
 * @param {{ repoRoot?: string }} opts
 * @returns {Promise<string>} path of written file
 */
export async function writeBacklogEntry(item, reason, opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  const dir = join(repoRoot, 'doc', 'evolution', 'backlog');
  await mkdir(dir, { recursive: true });

  const date = utcDateString(new Date());
  const itemId = item.itemId || item.id || 'unknown';
  const name = `${date}-${itemId}.md`;
  const p = join(dir, name);
  const sourceUrl = item.url || item.link || '';
  const title = item.title || itemId;
  const riskLevel = item.riskLevel || 'high';
  const tags = item.capabilityTags || [];

  const body = `---
status: backlog
date_utc: ${JSON.stringify(new Date().toISOString())}
risk_level: ${JSON.stringify(riskLevel)}
source_url: ${JSON.stringify(sourceUrl)}
source_title: ${JSON.stringify(title)}
reason: ${JSON.stringify(reason)}
---

# Backlog: ${title}

## 来源
${sourceUrl ? `- [${title}](${sourceUrl})` : '_无链接_'}

## 高风险原因

${reason}

## 能力标签

${tags.length > 0 ? tags.map((t) => `- \`${t}\``).join('\n') : '_无_'}

## 处置建议

此条目风险等级为 \`${riskLevel}\`，已跳过自动合并。请人工审查实验分支后决定是否合并或创建 PR。
`;
  await writeFile(p, body, 'utf8');
  console.log(`evolution-merge-gate: wrote backlog entry ${p}`);
  return p;
}
