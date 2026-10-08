#!/usr/bin/env node
// @ts-nocheck
/**
 * Mutation gate (StrykerJS + tap runner, mutating compiled packages/core/dist files in place).
 *
 *   npm run test:mutation                          all modules, gate on scripts/mutation/mutation.config.json thresholds
 *   npm run test:mutation -- --module bot-policy   one module (comma-separated list allowed)
 *   npm run test:mutation -- --list                list modules and thresholds
 *   npm run test:mutation -- --update-thresholds   ratchet thresholds up to the achieved scores (rounded down)
 *
 * Options:
 *   --shard i/n         run only slice i of n of each whole-file target (CI matrix); gate later with --summarize
 *   --summarize         do not run Stryker; merge the reports already in --out and gate them
 *   --concurrency <n>   Stryker worker processes (default: Stryker's own, cpus-1)
 *   --incremental       reuse coverage/mutation/incremental/<module>-<shard>.json from an earlier run
 *   --force             with --incremental: re-test every mutant but still refresh the incremental file
 *   --no-build          skip `tsc -b packages/core` (dist must already match src)
 *   --no-gate           always exit 0 after writing the summary
 *   --out <dir>         report directory (default coverage/mutation)
 *
 * Exit codes: 0 pass, 1 a module is below its threshold (or a shard is missing), 2 a Stryker run failed.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { SourceMap } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INSTRUMENTED_MARKER,
  describeMutant,
  evaluateModule,
  isUndetected,
  mergeReports,
  mutateFiles,
  parseShard,
  ratchetThresholds,
  renderMarkdown,
  reportMutants,
  resolveMutateEntries,
  skipPatternArg,
} from './mutation-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG_PATH = path.join(ROOT, 'scripts/mutation/mutation.config.json');
const STRYKER_BIN = path.join(ROOT, 'node_modules/@stryker-mutator/core/bin/stryker.js');

function parseArgs(argv) {
  const args = { modules: [], build: true, gate: true, out: path.join(ROOT, 'coverage/mutation') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--module' || a === '-m') args.modules.push(...argv[++i].split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--shard') args.shard = parseShard(argv[++i]);
    else if (a === '--summarize') args.summarize = true;
    else if (a === '--concurrency') args.concurrency = Number(argv[++i]);
    else if (a === '--incremental') args.incremental = true;
    else if (a === '--force') args.force = true;
    else if (a === '--no-build') args.build = false;
    else if (a === '--no-gate') args.gate = false;
    else if (a === '--update-thresholds') args.update = true;
    else if (a === '--allow-decrease') args.allowDecrease = true;
    else if (a === '--out') args.out = path.resolve(argv[++i]);
    else if (a === '--list') args.list = true;
    else if (a === '--help' || a === '-h') {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    } else throw new Error(`unknown argument: ${a}`);
  }
  if (args.concurrency !== undefined && !(args.concurrency >= 1)) throw new Error('--concurrency must be >= 1');
  return args;
}

const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const LOCK_PATH = path.join(ROOT, '.stryker-tmp/mutation.lock');

/**
 * Two in-place runs in one checkout poison each other: every instrumented file reads the same
 * __STRYKER_ACTIVE_MUTANT__ id, so a test process of run A also switches on mutants of run B.
 */
function acquireLock() {
  fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
  try {
    const pid = Number(fs.readFileSync(LOCK_PATH, 'utf8'));
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 0);
        console.error(`[mutation] another mutation run (pid ${pid}) is active in this checkout; wait for it to finish`);
        process.exit(2);
      } catch {
        // stale lock from a crashed run
      }
    }
  } catch {
    // no lock yet
  }
  fs.writeFileSync(LOCK_PATH, String(process.pid));
  process.on('exit', () => {
    try {
      if (fs.readFileSync(LOCK_PATH, 'utf8') === String(process.pid)) fs.rmSync(LOCK_PATH);
    } catch {
      // already gone
    }
  });
}

function ensureCleanDist(config, ids) {
  const polluted = [];
  for (const id of ids) {
    for (const file of mutateFiles(config.modules[id].mutate)) {
      const abs = path.join(ROOT, file);
      if (fs.existsSync(abs) && fs.readFileSync(abs, 'utf8').includes(INSTRUMENTED_MARKER)) polluted.push(abs);
    }
  }
  // An interrupted in-place run can leave instrumented code behind; tsc -b only re-emits missing outputs.
  for (const abs of polluted) {
    console.warn(`[mutation] ${path.relative(ROOT, abs)} still contains Stryker instrumentation; removing it so tsc re-emits it`);
    fs.rmSync(abs);
  }
  return polluted.length;
}

function build() {
  console.log('[mutation] $ tsc -b packages/core');
  const res = spawnSync(process.execPath, [path.join(ROOT, 'node_modules/typescript/bin/tsc'), '-b', 'packages/core'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    console.error('[mutation] build failed');
    process.exit(2);
  }
}

function shardTag(shard) {
  return shard && shard.count > 1 ? `shard-${shard.index}-of-${shard.count}` : 'all';
}

function runModule(config, id, args) {
  const mod = config.modules[id];
  const effective = args.shard && args.shard.count > 1 ? args.shard : undefined;
  const mutate = resolveMutateEntries(mod.mutate, readRel, effective);
  const tag = shardTag(effective);
  const moduleDir = path.join(args.out, id);
  const runDir = path.join(moduleDir, tag);
  // A whole-module run supersedes any shard reports; a shard run only replaces its own slice.
  if (tag === 'all') fs.rmSync(moduleDir, { recursive: true, force: true });
  else for (const stale of ['all', tag]) fs.rmSync(path.join(moduleDir, stale), { recursive: true, force: true });
  fs.mkdirSync(runDir, { recursive: true });
  const meta = { id, shard: effective ?? null, mutate, startedAt: new Date().toISOString() };
  if (mutate.length === 0) {
    fs.writeFileSync(path.join(runDir, 'meta.json'), JSON.stringify({ ...meta, empty: true }, null, 2));
    console.log(`[mutation] ${id} ${tag}: no code in this shard`);
    return { skipped: true };
  }

  const strykerConfig = {
    $schema: '../../../node_modules/@stryker-mutator/core/schema/stryker-schema.json',
    testRunner: 'tap',
    plugins: ['@stryker-mutator/tap-runner'],
    inPlace: true,
    coverageAnalysis: 'perTest',
    mutate,
    tap: {
      testFiles: mod.testFiles,
      nodeArgs: ['--test-reporter=tap', ...skipPatternArg(mod.skipTests), '-r', '{{hookFile}}', '{{testFile}}'],
      forceBail: true,
    },
    reporters: ['json', 'html', 'progress'],
    jsonReporter: { fileName: path.relative(ROOT, path.join(runDir, 'mutation.json')) },
    htmlReporter: { fileName: path.relative(ROOT, path.join(runDir, 'mutation.html')) },
    tempDirName: `.stryker-tmp/${id}-${tag}`,
    timeoutMS: config.timeoutMS ?? 10000,
    thresholds: { high: 80, low: 60, break: null },
    ...(args.concurrency ? { concurrency: args.concurrency } : {}),
    ...(args.incremental
      ? {
          incremental: true,
          force: Boolean(args.force),
          incrementalFile: path.relative(ROOT, path.join(args.out, 'incremental', `${id}-${tag}.json`)),
        }
      : {}),
  };
  const configFile = path.join(runDir, 'stryker.config.json');
  fs.writeFileSync(configFile, JSON.stringify(strykerConfig, null, 2));
  console.log(`\n[mutation] ▶ ${id} ${tag}: ${mutate.join(' ')}`);
  const started = Date.now();
  const res = spawnSync(process.execPath, [STRYKER_BIN, 'run', configFile], { cwd: ROOT, stdio: 'inherit' });
  const durationMs = Date.now() - started;
  fs.writeFileSync(path.join(runDir, 'meta.json'), JSON.stringify({ ...meta, durationMs, exitCode: res.status }, null, 2));
  const reportOk = fs.existsSync(path.join(runDir, 'mutation.json'));
  if (res.status !== 0 || !reportOk) {
    console.error(`[mutation] ${id} ${tag}: Stryker exited ${res.status}${reportOk ? '' : ' without a report'}`);
    return { failed: true };
  }
  return { durationMs };
}

const sourceMaps = new Map();
function srcLocation(fileName, line, column) {
  const abs = path.isAbsolute(fileName) ? fileName : path.join(ROOT, fileName);
  if (!sourceMaps.has(abs)) {
    let map = null;
    try {
      map = new SourceMap(JSON.parse(fs.readFileSync(`${abs}.map`, 'utf8')));
    } catch {
      map = null;
    }
    sourceMaps.set(abs, map);
  }
  const map = sourceMaps.get(abs);
  const entry = map?.findEntry(line - 1, Math.max(0, column - 1));
  if (!entry || entry.originalLine === undefined) return undefined;
  const file = path.relative(ROOT, path.resolve(path.dirname(abs), entry.originalSource.replace(/^file:\/\//, '')));
  return { file, line: entry.originalLine + 1 };
}

function collectModule(config, id, out) {
  const moduleDir = path.join(out, id);
  const dirs = fs.existsSync(moduleDir) ? fs.readdirSync(moduleDir).filter((d) => fs.existsSync(path.join(moduleDir, d, 'meta.json'))) : [];
  if (dirs.length === 0) return { id, missing: 'no report' };
  const metas = dirs.map((d) => ({ dir: d, ...JSON.parse(fs.readFileSync(path.join(moduleDir, d, 'meta.json'), 'utf8')) }));
  const sharded = metas.filter((m) => m.shard);
  if (sharded.length) {
    const count = sharded[0].shard.count;
    const have = new Set(sharded.map((m) => m.shard.index));
    const lacking = Array.from({ length: count }, (_, i) => i + 1).filter((i) => !have.has(i));
    if (lacking.length) return { id, missing: `shard(s) ${lacking.join(', ')} of ${count} missing` };
  }
  const reports = [];
  for (const m of metas) {
    if (m.empty) continue;
    const file = path.join(moduleDir, m.dir, 'mutation.json');
    if (!fs.existsSync(file)) return { id, missing: `${m.dir} has no mutation.json` };
    reports.push(JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  const merged = mergeReports(reports);
  const mutants = reportMutants(merged);
  const durationMs = metas.reduce((sum, m) => sum + (m.durationMs ?? 0), 0);
  const result = evaluateModule({
    id,
    threshold: config.modules[id].threshold,
    mutants,
    durationMs,
    shards: sharded.length || 1,
  });
  result.undetected = mutants
    .filter((m) => isUndetected(m.status))
    .sort((a, b) => a.fileName.localeCompare(b.fileName) || a.location.start.line - b.location.start.line)
    .map((m) => describeMutant({ ...m, srcLocation: srcLocation(m.fileName, m.location.start.line, m.location.start.column) }));
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const all = Object.keys(config.modules);
  const unknown = args.modules.filter((m) => !all.includes(m));
  if (unknown.length) throw new Error(`unknown module(s): ${unknown.join(', ')} (known: ${all.join(', ')})`);
  const ids = args.modules.length ? args.modules : all;

  if (args.list) {
    for (const id of all) {
      const m = config.modules[id];
      console.log(`${id.padEnd(24)} threshold ${String(m.threshold).padStart(3)}%  ${m.description ?? ''}`);
    }
    return;
  }

  let runFailed = false;
  if (!args.summarize) {
    acquireLock();
    const polluted = ensureCleanDist(config, ids);
    if (args.build || polluted) build();
    for (const id of ids) {
      const r = runModule(config, id, args);
      if (r.failed) runFailed = true;
    }
    if (ensureCleanDist(config, ids)) {
      console.error('[mutation] Stryker left instrumented dist files behind; they were removed, rebuild before using dist');
      runFailed = true;
    }
    if (args.shard) {
      console.log(`[mutation] shard ${args.shard.index}/${args.shard.count} done; gate with --summarize after all shards`);
      process.exit(runFailed ? 2 : 0);
    }
  }

  const modules = ids.map((id) => {
    const r = collectModule(config, id, args.out);
    if (r.missing) return { id, threshold: config.modules[id].threshold, score: null, pass: false, missing: r.missing, killed: 0, timeout: 0, survived: 0, noCoverage: 0, ignored: 0, errors: 0 };
    return r;
  });
  const summary = { generatedAt: new Date().toISOString(), pass: !runFailed && modules.every((m) => m.pass), modules };

  if (args.update) {
    const changes = ratchetThresholds(config, modules, { allowDecrease: args.allowDecrease });
    fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
    for (const c of changes) console.log(`[mutation] threshold ${c.id}: ${c.from}% -> ${c.to}%`);
    if (!changes.length) console.log('[mutation] thresholds unchanged');
  }

  fs.mkdirSync(args.out, { recursive: true });
  fs.writeFileSync(path.join(args.out, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  const md = renderMarkdown(summary);
  fs.writeFileSync(path.join(args.out, 'summary.md'), md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);

  console.log('\n[mutation] summary');
  for (const m of modules) {
    const score = m.score === null ? '  n/a ' : `${m.score.toFixed(2).padStart(6)}%`;
    const extra = m.missing ? `  (${m.missing})` : `  killed ${m.killed + m.timeout}, undetected ${m.survived + m.noCoverage}`;
    console.log(`  ${m.pass ? 'PASS' : 'FAIL'}  ${m.id.padEnd(24)} ${score}  >= ${m.threshold}%${extra}`);
  }
  console.log(`[mutation] reports: ${path.relative(ROOT, args.out)}/summary.{json,md}, <module>/*/mutation.html`);
  if (runFailed) process.exit(2);
  if (args.gate && !summary.pass) process.exit(1);
}

main();
