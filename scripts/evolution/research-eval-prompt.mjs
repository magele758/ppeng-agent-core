/**
 * Single source of truth for evolution research-stage evaluation prompts.
 * Used by research-cursor.mjs and evolution-research.sh (via `node ...` stdout).
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeSourceAvailability } from './research-gate.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dir, '..', '..');

const STRICTNESS = new Set(['strict', 'balanced', 'recall']);

function stanceBlock(strictness) {
  if (strictness === 'strict') {
    return `Be VERY selective: most items should be SKIP. Only PROCEED when the article exposes a specific, clearly missing capability in this repo and a bounded patch is obviously safe.`;
  }
  if (strictness === 'recall') {
    return `Bias toward finding value: PROCEED when the source gives any concrete angle (API, protocol, pattern, tool, security, performance, reliability, observability, DX, testing, or MCP/agent integration) that could plausibly improve this monorepo with a small-to-medium scoped change—even if the article is not exclusively about this stack. Use SKIP only when no reasonable bounded improvement exists, or the idea is clearly superseded, duplicated, irrelevant, outdated, or needs a disruptive refactor.`;
  }
  return `Be selective without discarding real opportunities (balanced default). PROCEED when the source suggests at least one concrete, implementable improvement: new or better tool behavior, protocol handling, security hardening, performance, reliability, observability, developer experience, tests, or agent/MCP ergonomics—if it could realistically land in this repo with bounded risk. Prefer PROCEED for incremental wins and well-scoped pattern adoptions. Use SKIP when the content is purely marketing, has no technical hook, is clearly already covered by better code here, is a duplicate, is obsolete, or would require a large disruptive rewrite.`;
}

function availabilityBlock(availability) {
  if (availability === 'full') {
    return 'Source strength: **full** — excerpt or arXiv abstract is substantial; compare in detail against the codebase.';
  }
  if (availability === 'weak') {
    return `Source strength: **weak** — excerpt is short, missing, or fetch may be partial; you still have the inbox title and canonical URL. PROCEED only if the title/URL/excerpt together imply a clear, bounded improvement angle for this repository. If the signal is too thin to justify engineering time, SKIP: IRRELEVANT with a one-line explanation.`;
  }
  return 'Source strength: **none** — you should not reach this block in normal runs.';
}

/**
 * @param {'full'|'weak'|'none'} availability
 * @param {'strict'|'balanced'|'recall'} strictness
 */
export function buildResearchEvaluationPrompt(ctx) {
  const {
    worktreePath,
    availability = 'full',
    strictness = 'balanced',
    constraintsText = '',
    excerptText = '',
    arxivContent = '',
    sourceTitle = '',
    sourceUrl = '',
    fetchNote = ''
  } = ctx;

  const s = STRICTNESS.has(strictness) ? strictness : 'balanced';

  const meta = [];
  if (sourceTitle) meta.push(`**Inbox title:** ${sourceTitle}`);
  if (sourceUrl) meta.push(`**Source URL:** ${sourceUrl}`);
  if (fetchNote) meta.push(`**Fetch / ingest note:** ${fetchNote}`);

  return `You are a senior architect evaluating whether a source offers a REAL, IMPLEMENTABLE capability improvement for a TypeScript/Node.js multi-agent runtime repository at: ${worktreePath}

The repository provides:
- Multi-agent runtime: sessions, tool calls, approval policies, MCP client integration
- Capability Gateway: HTTP/SSE routing, RSS-based learning (evolution ingest)
- Web console (Next.js): chat UI, streaming, tool call display
- Self-heal subsystem: autonomous test-fix-merge loop

${availabilityBlock(availability)}

${stanceBlock(s)}

Your workflow:
1) Extract the concrete technical hooks from the source (APIs, algorithms, threat models, UX flows, operational patterns—not slogans).
2) Map at most **three** candidate improvements to specific subsystems of this repo (name paths or modules if you can infer them from the excerpt + typical layout).
3) If any candidate is both valuable and bounded, choose the single best and PROCEED; otherwise SKIP with the best-matching category.

${meta.length ? `## Inbox / fetch context\n${meta.join('\n')}\n` : ''}${constraintsText ? `## Project constraints\n${constraintsText}\n` : ''}${excerptText ? `## Source excerpt\n${excerptText}\n` : ''}${arxivContent || ''}

## Required output format

For a valuable improvement (after mapping to this repo):
  PROCEED
  <one primary change: package/path or subsystem + one sentence why it is missing or underpowered today>

For no worthwhile bounded change:
  SKIP: SUPERSEDED   — current implementation is already better
  SKIP: DUPLICATE    — already implemented equivalently
  SKIP: IRRELEVANT   — not applicable to this codebase
  SKIP: OUTDATED     — article describes deprecated approach
  SKIP: TOO_COMPLEX  — would require major refactor

Output the decision as the **first line** starting with PROCEED or SKIP so automation can parse it. You may add a short rationale on the following lines.`;
}

/** @param {import('./research-gate.mjs').SourceAvailability} availability */
export function readPromptContextFromEnv() {
  const wt = process.env.EVOLUTION_WORKTREE || process.cwd();
  const excerptFile = process.env.EVOLUTION_SOURCE_EXCERPT_FILE || '';
  const constraintsFile = process.env.EVOLUTION_AGENT_CONSTRAINTS_FILE || '';
  const strictnessRaw = (process.env.EVOLUTION_RESEARCH_STRICTNESS || 'balanced').trim().toLowerCase();

  const excerptText =
    excerptFile && existsSync(excerptFile) ? readFileSync(excerptFile, 'utf8').trim() : '';
  const constraintsText =
    constraintsFile && existsSync(constraintsFile) ? readFileSync(constraintsFile, 'utf8').trim() : '';

  const sourceUrl = (process.env.EVOLUTION_SOURCE_URL || '').trim();
  const sourceTitle = (process.env.EVOLUTION_SOURCE_TITLE || '').trim();
  const fetchNote = (process.env.EVOLUTION_SOURCE_FETCH_NOTE || '').trim();

  return {
    worktreePath: wt,
    strictness: strictnessRaw,
    constraintsText,
    excerptText,
    sourceTitle,
    sourceUrl,
    fetchNote
  };
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

async function fetchArxivBlock(sourceUrl) {
  if (!sourceUrl.includes('arxiv.org')) return '';
  try {
    const fetchRes = await runCommand('node', [join(repoRoot, 'scripts', 'arxiv-fetch.mjs'), sourceUrl], repoRoot);
    const { title, abstract } = JSON.parse(fetchRes.out.trim() || '{}');
    if (title && abstract) {
      return `\n\n## arXiv\n**标题:** ${title}\n\n### Abstract\n${abstract}\n`;
    }
  } catch {
    /* ignore */
  }
  return '';
}

async function main() {
  const base = readPromptContextFromEnv();
  const minFull = Math.max(
    120,
    Number.parseInt(String(process.env.EVOLUTION_RESEARCH_FULL_EXCERPT_MIN_CHARS || '500'), 10) || 500
  );
  const arxivContent = await fetchArxivBlock(base.sourceUrl);
  const hasArxivBlock = Boolean(arxivContent);
  const availability = computeSourceAvailability({
    excerptText: base.excerptText,
    sourceTitle: base.sourceTitle,
    sourceUrl: base.sourceUrl,
    hasArxivBlock,
    minFullChars: minFull
  });
  const prompt = buildResearchEvaluationPrompt({
    ...base,
    availability,
    strictness: base.strictness,
    arxivContent
  });
  process.stdout.write(prompt);
}

const isMain = process.argv[1]?.endsWith('research-eval-prompt.mjs');
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
