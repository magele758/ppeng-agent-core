import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, normalize } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const RESULT_TYPES = ['success', 'failure', 'skip', 'no-op'] as const;
type ResultType = (typeof RESULT_TYPES)[number];

interface EvolutionResult {
  type: ResultType;
  name: string;
  status: string;
  sourceTitle: string;
  sourceUrl: string;
  experimentBranch: string;
  dateUtc: string;
  merged: boolean;
  skipReason?: string;
  noOpReason?: string;
  featurePathsCount?: number;
  detectedTool: string | null;
}

interface ActiveWorktree {
  path: string;
  head: string;
  branch: string;
  isEvolution: boolean;
}

/** Parse the YAML-like frontmatter at the top of evolution result Markdown files. */
function parseFrontmatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m || !m[1]) return {};
  const fm: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^"(.*)"$/, '$1');
    if (key) fm[key] = val;
  }
  return fm;
}

/** Lightly detect the AI CLI tool used from agent hook output in the Markdown body. */
function detectTool(text: string): string | null {
  if (/evolution-agent-multi:\s+使用\s+(\w+)/.test(text)) {
    return RegExp.$1;
  }
  if (/evolution-agent-multi: using (\w+)/i.test(text)) {
    return RegExp.$1;
  }
  if (/OpenAI Codex/i.test(text) || /codex exec/i.test(text)) return 'codex';
  if (/claude\s+--dangerously/i.test(text) || /Claude Code/i.test(text)) return 'claude';
  if (/agent\s+--print/i.test(text)) return 'cursor';
  if (/gemini\s+-p/i.test(text)) return 'gemini';
  return null;
}

function json(response: ServerResponse<IncomingMessage>, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body, null, 2));
}

/** Parse `git worktree list --porcelain` output into structured entries. */
function parseWorktreeList(output: string): ActiveWorktree[] {
  const entries: ActiveWorktree[] = [];
  let current: Partial<ActiveWorktree> = {};
  for (const raw of output.split('\n')) {
    const line = raw.trim();
    if (!line) {
      if (current.path) {
        entries.push({
          path: current.path,
          head: current.head ?? '',
          branch: current.branch ?? '(detached)',
          isEvolution: current.path.includes('.evolution-worktrees') || (current.branch ?? '').includes('exp/evolution')
        });
      }
      current = {};
      continue;
    }
    if (line.startsWith('worktree ')) current.path = line.slice(9).trim();
    else if (line.startsWith('HEAD ')) current.head = line.slice(5).trim();
    else if (line.startsWith('branch ')) current.branch = line.slice(7).replace('refs/heads/', '').trim();
  }
  if (current.path) {
    entries.push({
      path: current.path,
      head: current.head ?? '',
      branch: current.branch ?? '(detached)',
      isEvolution: current.path.includes('.evolution-worktrees') || (current.branch ?? '').includes('exp/evolution')
    });
  }
  return entries;
}

export function handleEvolutionApi(
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  repoRoot: string
): boolean {
  const url = new URL(request.url ?? '/', `http://localhost`);
  const { pathname } = url;

  if (!pathname.startsWith('/api/evolution')) return false;
  if (request.method !== 'GET') {
    json(response, 405, { error: 'Method not allowed' });
    return true;
  }

  const sub = pathname.slice('/api/evolution'.length);

  // GET /api/evolution/overview
  if (sub === '/overview' || sub === '/overview/') {
    handleOverview(response, repoRoot, url);
    return true;
  }

  // GET /api/evolution/results
  if (sub === '/results' || sub === '/results/') {
    handleResults(response, repoRoot);
    return true;
  }

  // GET /api/evolution/result?type=success&name=xxx.md
  if (sub === '/result' || sub === '/result/') {
    handleResult(response, repoRoot, url);
    return true;
  }

  return false;
}

async function handleOverview(
  response: ServerResponse<IncomingMessage>,
  repoRoot: string,
  url: URL
): Promise<void> {
  // Latest run log
  const runLogPath = join(repoRoot, 'doc', 'evolution', 'runs', 'latest-run-day.md');
  const latestRunLog = existsSync(runLogPath) ? readFileSync(runLogPath, 'utf8') : null;

  // Active worktrees via git
  let activeWorktrees: ActiveWorktree[] = [];
  try {
    const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot });
    activeWorktrees = parseWorktreeList(stdout).filter((w) => w.isEvolution);
  } catch {
    activeWorktrees = [];
  }

  // Inbox hint
  const inboxDir = join(repoRoot, 'doc', 'evolution', 'inbox');
  let inboxHint: string | null = null;
  if (existsSync(inboxDir)) {
    const today = new Date().toISOString().slice(0, 10);
    const todayFile = join(inboxDir, `${today}.md`);
    if (existsSync(todayFile)) {
      inboxHint = `${today}.md`;
    } else {
      const files = readdirSync(inboxDir).filter((f) => f.endsWith('.md')).sort().reverse();
      if (files.length > 0) inboxHint = files[0] ?? null;
    }
  }

  // Summary counts per type
  const counts: Record<string, number> = {};
  for (const t of RESULT_TYPES) {
    const d = join(repoRoot, 'doc', 'evolution', t);
    counts[t] = existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.md')).length : 0;
  }

  json(response, 200, { activeWorktrees, latestRunLog, inboxHint, counts });
}

function handleResults(response: ServerResponse<IncomingMessage>, repoRoot: string): void {
  const results: EvolutionResult[] = [];

  for (const type of RESULT_TYPES) {
    const dir = join(repoRoot, 'doc', 'evolution', type);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.md')) continue;
      try {
        const text = readFileSync(join(dir, name), 'utf8');
        const fm = parseFrontmatter(text);
        results.push({
          type,
          name,
          status: fm['status'] ?? type,
          sourceTitle: fm['source_title'] ?? name,
          sourceUrl: fm['source_url'] ?? '',
          experimentBranch: fm['experiment_branch'] ?? '',
          dateUtc: fm['date_utc'] ?? '',
          merged: fm['merged'] === 'true',
          skipReason: fm['skip_reason'] ?? undefined,
          noOpReason: fm['no_op_reason'] ?? undefined,
          featurePathsCount: fm['feature_paths_count'] ? Number(fm['feature_paths_count']) : undefined,
          detectedTool: detectTool(text)
        });
      } catch {
        // skip unreadable files
      }
    }
  }

  results.sort((a, b) => b.dateUtc.localeCompare(a.dateUtc));
  json(response, 200, { results: results.slice(0, 100) });
}

function handleResult(response: ServerResponse<IncomingMessage>, repoRoot: string, url: URL): void {
  const type = url.searchParams.get('type') ?? '';
  const name = url.searchParams.get('name') ?? '';

  if (!RESULT_TYPES.includes(type as ResultType)) {
    json(response, 400, { error: `Invalid type; must be one of ${RESULT_TYPES.join(', ')}` });
    return;
  }
  if (!/^[\w.-]+-[\da-f]{8}\.md$/.test(name) && !/^\d{4}-\d{2}-\d{2}-[\w.-]+\.md$/.test(name)) {
    json(response, 400, { error: 'Invalid name format' });
    return;
  }

  const filePath = normalize(join(repoRoot, 'doc', 'evolution', type, name));
  if (!filePath.startsWith(join(repoRoot, 'doc', 'evolution'))) {
    json(response, 400, { error: 'Path traversal not allowed' });
    return;
  }
  if (!existsSync(filePath)) {
    json(response, 404, { error: 'File not found' });
    return;
  }

  try {
    const markdown = readFileSync(filePath, 'utf8');
    json(response, 200, { markdown, type, name });
  } catch {
    json(response, 500, { error: 'Failed to read file' });
  }
}
