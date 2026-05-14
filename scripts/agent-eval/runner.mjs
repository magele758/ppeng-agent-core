#!/usr/bin/env node
/**
 * Harness Eval Runner
 * 用法: node scripts/agent-eval/runner.mjs [--mode fast|nightly] [--case <id>]
 */
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');

// ── 参数解析 ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let mode = 'fast';
let filterCase = null;
let exitOnFail = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--mode' && args[i + 1]) { mode = args[++i]; }
  else if (args[i] === '--case' && args[i + 1]) { filterCase = args[++i]; }
  else if (args[i] === '--exit-on-fail') { exitOnFail = true; }
}

// ── Daemon 启动 ────────────────────────────────────────────────────────────
const daemonEntry = join(repoRoot, 'apps', 'daemon', 'dist', 'server.js');
if (!existsSync(daemonEntry)) {
  console.error(`[eval] daemon dist missing — run \`npm run build\` first: ${daemonEntry}`);
  process.exit(2);
}

function sanitizeEnv(base) {
  const STRIP = new Set([
    'LD_PRELOAD', 'LD_LIBRARY_PATH', 'LD_AUDIT',
    'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH', 'DYLD_FRAMEWORK_PATH', 'DYLD_FALLBACK_LIBRARY_PATH',
    'NODE_OPTIONS',
    'PYTHONPATH', 'PYTHONSTARTUP', 'PYTHONHOME',
    'JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS',
    'RUBYLIB', 'RUBYOPT', 'PERL5LIB', 'PERL5OPT',
    'BASH_ENV', 'ENV', 'CDPATH', 'IFS', 'PROMPT_COMMAND', 'GLOBIGNORE', 'SHELLOPTS', 'BASHOPTS'
  ]);
  const out = { ...base };
  for (const k of Object.keys(out)) {
    if (STRIP.has(k) || k.startsWith('BASH_FUNC_')) delete out[k];
  }
  return out;
}

function spawnDaemon({ port, stateDir }) {
  const child = spawn(process.execPath, ['apps/daemon/dist/server.js'], {
    cwd: repoRoot,
    env: sanitizeEnv({
      ...process.env,
      RAW_AGENT_DAEMON_HOST: '127.0.0.1',
      RAW_AGENT_DAEMON_PORT: String(port),
      RAW_AGENT_STATE_DIR: stateDir,
      RAW_AGENT_E2E_ISOLATE: '1',
      RAW_AGENT_SELF_HEAL_AUTO_START: '0'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr?.on('data', (c) => { stderr += c.toString(); });
  return { child, getStderr: () => stderr };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForHealth(baseUrl, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const body = await res.json();
        if (body && (body.ok === true || body.status)) return body;
      }
    } catch (e) { lastErr = e; }
    await sleep(200);
  }
  throw new Error(`Health check timeout after ${timeoutMs}ms: ${lastErr?.message ?? 'unknown'}`);
}

async function killDaemon(child) {
  child.kill('SIGTERM');
  await new Promise(resolve => {
    const t = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000);
    child.once('exit', () => { clearTimeout(t); resolve(); });
  });
}

// ── 创建临时 session ────────────────────────────────────────────────────────
async function createTempSession(baseUrl) {
  const res = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'chat', title: 'eval-temp', autoRun: false }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!res.ok) throw new Error(`createTempSession failed: HTTP ${res.status}`);
  const data = await res.json();
  const id = data.session?.id;
  if (!id) throw new Error('createTempSession: missing session.id');
  return id;
}

// ── 执行单个 case ───────────────────────────────────────────────────────────
async function runCase(kase, baseUrl) {
  const start = Date.now();
  const { checks } = kase;
  let status = 'fail';
  let failureType = null;
  let details = '';

  try {
    let path = checks.path;

    // 需要先创建 session，再替换路径中的 :newSession
    if (checks.createSession) {
      const sid = await createTempSession(baseUrl);
      path = path.replace(':newSession', sid);
    }

    const url = `${baseUrl}${path}`;
    const fetchOpts = {
      method: checks.method ?? 'GET',
      signal: AbortSignal.timeout(15_000)
    };

    if (checks.body && checks.method === 'POST') {
      fetchOpts.headers = { 'content-type': 'application/json' };
      fetchOpts.body = JSON.stringify(checks.body);
    }

    const res = await fetch(url, fetchOpts);

    // 状态码检查
    const expectedStatus = checks.expectedStatus ?? 200;
    if (res.status !== expectedStatus) {
      failureType = 'wrong_status';
      details = `expected HTTP ${expectedStatus}, got ${res.status}`;
      return { status: 'fail', failureType, details, duration_ms: Date.now() - start };
    }

    // body 字段检查
    if (checks.bodyContainsField || checks.fieldIsArray) {
      const text = await res.text();
      let body;
      try { body = JSON.parse(text); } catch {
        failureType = 'parse_error';
        details = 'response is not JSON';
        return { status: 'fail', failureType, details, duration_ms: Date.now() - start };
      }

      if (checks.bodyContainsField && !(checks.bodyContainsField in body)) {
        failureType = 'missing_field';
        details = `body missing field: ${checks.bodyContainsField}`;
        return { status: 'fail', failureType, details, duration_ms: Date.now() - start };
      }

      if (checks.fieldIsArray) {
        const val = body[checks.fieldIsArray];
        if (!Array.isArray(val)) {
          failureType = 'not_array';
          details = `field ${checks.fieldIsArray} is not an array`;
          return { status: 'fail', failureType, details, duration_ms: Date.now() - start };
        }
      }
    } else {
      // consume body
      await res.text();
    }

    status = 'pass';
    details = `HTTP ${res.status}`;
  } catch (e) {
    failureType = 'exception';
    details = e instanceof Error ? e.message : String(e);
  }

  return { status, failureType, details, duration_ms: Date.now() - start };
}

// ── 加载 cases ──────────────────────────────────────────────────────────────
function loadCases(targetMode, caseFilter) {
  const casesDir = join(__dirname, 'cases', targetMode);
  if (!existsSync(casesDir)) {
    console.warn(`[eval] cases dir not found: ${casesDir}`);
    return [];
  }
  const files = readdirSync(casesDir).filter(f => f.endsWith('.json'));
  const cases = files.map(f => JSON.parse(readFileSync(join(casesDir, f), 'utf8')));
  if (caseFilter) return cases.filter(c => c.id === caseFilter);
  return cases;
}

// ── 输出格式 ────────────────────────────────────────────────────────────────
const PASS = '\x1b[32mPASS\x1b[0m';
const FAIL = '\x1b[31mFAIL\x1b[0m';
const SKIP = '\x1b[33mSKIP\x1b[0m';

function statusLabel(s) {
  if (s === 'pass') return PASS;
  if (s === 'fail') return FAIL;
  return SKIP;
}

function printTable(results) {
  const idW = Math.max(6, ...results.map(r => r.case_id.length));
  const capW = Math.max(10, ...results.map(r => r.capability.length));
  const sep = `${'-'.repeat(idW + 2)}-+-${'-'.repeat(capW + 2)}-+--------+---------+--${'-'.repeat(40)}`;
  const hdr = ` ${'CASE ID'.padEnd(idW)} | ${'CAPABILITY'.padEnd(capW)} | STATUS | DURATION | DETAILS`;
  console.log('\n' + sep);
  console.log(hdr);
  console.log(sep);
  for (const r of results) {
    const status = r.status === 'pass' ? PASS : r.status === 'fail' ? FAIL : SKIP;
    const dur = `${r.duration_ms}ms`.padStart(8);
    const details = (r.details ?? '').slice(0, 60);
    console.log(` ${r.case_id.padEnd(idW)} | ${r.capability.padEnd(capW)} | ${status} | ${dur} | ${details}`);
  }
  console.log(sep);
}

// ── 写结果 ───────────────────────────────────────────────────────────────────
function writeResults(results) {
  const outDir = join(repoRoot, 'doc', 'eval-results');
  mkdirSync(outDir, { recursive: true });
  const dateStr = new Date().toISOString().slice(0, 10);
  const outFile = join(outDir, `${dateStr}.jsonl`);
  for (const r of results) {
    appendFileSync(outFile, JSON.stringify(r) + '\n', 'utf8');
  }
  console.log(`\n[eval] results written to ${outFile}`);
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const cases = loadCases(mode, filterCase);
  if (cases.length === 0) {
    console.error(`[eval] no cases found for mode=${mode}${filterCase ? ` case=${filterCase}` : ''}`);
    process.exit(1);
  }

  console.log(`[eval] mode=${mode} cases=${cases.length} ${filterCase ? `filter=${filterCase}` : ''}`);

  const port = 18_000 + Math.floor(Math.random() * 2000);
  const stateDir = mkdtempSync(join(tmpdir(), 'ppeng-eval-'));
  const baseUrl = `http://127.0.0.1:${port}`;

  console.log(`[eval] spawning daemon on port ${port} ...`);
  const { child, getStderr } = spawnDaemon({ port, stateDir });

  const results = [];
  let daemonOk = false;

  try {
    await waitForHealth(baseUrl, 25_000);
    daemonOk = true;
    console.log(`[eval] daemon ready at ${baseUrl}\n`);

    for (const kase of cases) {
      process.stdout.write(`  running ${kase.id} ... `);
      const r = await runCase(kase, baseUrl);
      const result = {
        case_id: kase.id,
        capability: kase.capability,
        mode: kase.mode,
        status: r.status,
        duration_ms: r.duration_ms,
        failure_type: r.failureType ?? null,
        details: r.details ?? ''
      };
      results.push(result);
      process.stdout.write(`${statusLabel(r.status)} (${r.duration_ms}ms)\n`);
    }
  } catch (e) {
    console.error(`\n[eval] fatal: ${e.message}`);
    if (getStderr().trim()) {
      console.error('[eval] daemon stderr:\n', getStderr().slice(-2000));
    }
    // mark remaining cases as skip
    for (const kase of cases) {
      if (!results.find(r => r.case_id === kase.id)) {
        results.push({
          case_id: kase.id,
          capability: kase.capability,
          mode: kase.mode,
          status: 'skip',
          duration_ms: 0,
          failure_type: 'daemon_error',
          details: e.message
        });
      }
    }
  } finally {
    await killDaemon(child);
    rmSync(stateDir, { recursive: true, force: true });
  }

  printTable(results);
  writeResults(results);

  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const skipped = results.filter(r => r.status === 'skip').length;

  console.log(`\n[eval] summary: ${passed} passed, ${failed} failed, ${skipped} skipped / ${results.length} total`);

  if (exitOnFail && (failed > 0 || !daemonOk)) {
    process.exit(1);
  } else if (!exitOnFail) {
    // Print-only mode: always exit 0 regardless of failures
    process.exit(0);
  }
  // exitOnFail=true and no failures → implicit exit 0
}

main().catch(e => {
  console.error('[eval] uncaught:', e);
  process.exit(1);
});
