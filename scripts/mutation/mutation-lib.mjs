// @ts-nocheck
/**
 * Pure helpers for the mutation gate (scripts/mutation/run-mutation.mjs).
 * Kept free of process / Stryker side effects so scripts/test/mutation-lib.test.mjs can cover them.
 */
import ts from 'typescript';

/** Marker Stryker's instrumenter puts in every mutated file; seeing it in dist means a run crashed mid-way. */
export const INSTRUMENTED_MARKER = 'stryMutAct_9fa48';

const DETECTED = new Set(['Killed', 'Timeout']);
const UNDETECTED = new Set(['Survived', 'NoCoverage']);
const INVALID = new Set(['CompileError', 'RuntimeError']);

/** Same definition as Stryker's "mutation score": detected / (detected + undetected); ignored and invalid mutants do not count. */
export function tallyMutants(mutants) {
  const counts = { killed: 0, timeout: 0, survived: 0, noCoverage: 0, ignored: 0, errors: 0, pending: 0, total: 0 };
  for (const m of mutants) {
    counts.total += 1;
    if (m.status === 'Killed') counts.killed += 1;
    else if (m.status === 'Timeout') counts.timeout += 1;
    else if (m.status === 'Survived') counts.survived += 1;
    else if (m.status === 'NoCoverage') counts.noCoverage += 1;
    else if (m.status === 'Ignored') counts.ignored += 1;
    else if (INVALID.has(m.status)) counts.errors += 1;
    else counts.pending += 1;
  }
  const detected = counts.killed + counts.timeout;
  const valid = detected + counts.survived + counts.noCoverage;
  counts.score = valid === 0 ? null : Math.floor((detected / valid) * 10000) / 100;
  return counts;
}

export function isUndetected(status) {
  return UNDETECTED.has(status);
}

export function isDetected(status) {
  return DETECTED.has(status);
}

/**
 * Merge several Stryker JSON reports (mutation-testing-report-schema) into one.
 * Shards of a module mutate disjoint ranges of the same file, so mutants are concatenated per file;
 * a mutant id seen twice (same report passed twice) is kept once.
 */
export function mergeReports(reports) {
  const files = {};
  for (const report of reports) {
    for (const [name, file] of Object.entries(report.files ?? {})) {
      const slot = (files[name] ??= { ...file, mutants: [] });
      const seen = new Set(slot.mutants.map((m) => `${m.id}@${loc(m)}`));
      for (const m of file.mutants ?? []) {
        const key = `${m.id}@${loc(m)}`;
        if (!seen.has(key)) {
          seen.add(key);
          slot.mutants.push(m);
        }
      }
    }
  }
  const first = reports[0] ?? {};
  return { ...first, files };
}

function loc(m) {
  const s = m.location?.start ?? {};
  const e = m.location?.end ?? {};
  return `${s.line}:${s.column}-${e.line}:${e.column}:${m.mutatorName}:${m.replacement ?? ''}`;
}

export function reportMutants(report) {
  const out = [];
  for (const [fileName, file] of Object.entries(report.files ?? {})) {
    for (const m of file.mutants ?? []) out.push({ ...m, fileName, source: file.source });
  }
  return out;
}

function parseJs(fileName, text) {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

function lineOf(sf, pos) {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

/** 1-based inclusive [start, end] line span of every top-level statement. */
export function topLevelStatementSpans(fileName, text) {
  const sf = parseJs(fileName, text);
  return sf.statements.map((st) => [lineOf(sf, st.getStart(sf)), lineOf(sf, st.getEnd())]);
}

/**
 * Split a file into `count` contiguous line ranges that never cut a top-level statement
 * (Stryker only keeps a mutant whose node lies fully inside one range), balanced by line count.
 */
export function shardRanges(fileName, text, count) {
  const spans = topLevelStatementSpans(fileName, text);
  const lastLine = text.split('\n').length;
  if (count <= 1 || spans.length === 0) return [[1, lastLine]];
  const totalLines = spans[spans.length - 1][1];
  const ranges = [];
  let i = 0;
  for (let shard = 1; shard <= count && i < spans.length; shard += 1) {
    const start = ranges.length ? ranges[ranges.length - 1][1] + 1 : 1;
    if (shard === count) {
      ranges.push([start, lastLine]);
      break;
    }
    const target = (totalLines * shard) / count;
    let end = spans[i][1];
    i += 1;
    while (i < spans.length && spans.length - i > count - shard && spans[i][1] <= target) {
      end = spans[i][1];
      i += 1;
    }
    ranges.push([start, i >= spans.length ? lastLine : end]);
  }
  return ranges;
}

/**
 * Line ranges of named functions / class methods (top-level or inside a class) in a compiled JS file.
 * Throws when a name is missing so a rename can't silently shrink what the gate mutates.
 */
export function functionRanges(fileName, text, names) {
  const sf = parseJs(fileName, text);
  const wanted = new Set(names);
  const found = new Map();
  const visit = (node) => {
    let name;
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
      name = node.name.text;
    }
    if (name && wanted.has(name) && !found.has(name)) {
      found.set(name, [lineOf(sf, node.getStart(sf)), lineOf(sf, node.getEnd())]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const missing = names.filter((n) => !found.has(n));
  if (missing.length) throw new Error(`${fileName}: functions not found: ${missing.join(', ')}`);
  return names.map((n) => found.get(n));
}

/**
 * Expand module mutate entries into Stryker `mutate` strings.
 * Entry forms: "path.js" (whole file) or { file, functions: [...] }.
 * With shard {index, count}, only the shard's slice of whole-file entries is kept
 * (function-scoped entries are small and stay in shard 1).
 */
export function resolveMutateEntries(entries, readFile, shard) {
  const out = [];
  for (const entry of entries) {
    if (typeof entry === 'string') {
      if (!shard || shard.count <= 1) {
        out.push(entry);
        continue;
      }
      const ranges = shardRanges(entry, readFile(entry), shard.count);
      const range = ranges[shard.index - 1];
      if (range) out.push(`${entry}:${range[0]}-${range[1]}`);
      continue;
    }
    if (shard && shard.count > 1 && shard.index !== 1) continue;
    for (const [s, e] of functionRanges(entry.file, readFile(entry.file), entry.functions)) {
      out.push(`${entry.file}:${s}-${e}`);
    }
  }
  return out;
}

export function mutateFiles(entries) {
  return [...new Set(entries.map((e) => (typeof e === 'string' ? e : e.file)))];
}

export function parseShard(raw) {
  if (!raw) return undefined;
  const m = /^(\d+)\/(\d+)$/.exec(String(raw));
  if (!m) throw new Error(`--shard must look like 1/3, got ${raw}`);
  const index = Number(m[1]);
  const count = Number(m[2]);
  if (index < 1 || index > count) throw new Error(`--shard index out of range: ${raw}`);
  return { index, count };
}

/** Escape a test name for node --test-skip-pattern (a /regex/). */
export function skipPatternArg(names) {
  if (!names?.length) return [];
  const body = names.map((n) => n.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|');
  return [`--test-skip-pattern=/${body}/`];
}

export function evaluateModule({ id, threshold, mutants, durationMs, shards }) {
  const counts = tallyMutants(mutants);
  const pass = counts.pending === 0 && counts.score !== null && counts.score >= threshold;
  return { id, threshold, ...counts, pass, durationMs, shards };
}

/** Ratchet: thresholds only move up, to the achieved score rounded down. */
export function ratchetThresholds(config, results, { allowDecrease = false } = {}) {
  const changes = [];
  for (const r of results) {
    const mod = config.modules[r.id];
    if (!mod || r.score === null) continue;
    const next = Math.floor(r.score);
    if (next > mod.threshold || (allowDecrease && next < mod.threshold)) {
      changes.push({ id: r.id, from: mod.threshold, to: next });
      mod.threshold = next;
    }
  }
  return changes;
}

function cell(text) {
  return String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** Short one-line view of a mutant: `src/x.ts:12 ConditionalExpression → true`. */
export function describeMutant(m) {
  const where = m.srcLocation ? `${m.srcLocation.file}:${m.srcLocation.line}` : `${m.fileName}:${m.location.start.line}`;
  const replacement = (m.replacement ?? '').replace(/\s+/g, ' ').slice(0, 80);
  return { where, mutator: m.mutatorName, replacement, status: m.status };
}

export function renderMarkdown(summary, { maxSurvivedPerModule = 40 } = {}) {
  const lines = [];
  lines.push(`## Mutation testing ${summary.pass ? 'passed' : 'FAILED'}`);
  lines.push('');
  lines.push('| module | score | threshold | killed | timeout | survived | no cov | ignored | errors | time |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const m of summary.modules) {
    const score = m.score === null ? 'n/a' : `${m.score.toFixed(2)}%`;
    const mark = m.pass ? '' : ' ❌';
    const time = m.durationMs ? `${Math.round(m.durationMs / 1000)}s` : '';
    lines.push(
      `| ${m.id}${mark} | ${score} | ${m.threshold}% | ${m.killed} | ${m.timeout} | ${m.survived} | ${m.noCoverage} | ${m.ignored} | ${m.errors} | ${time} |`
    );
  }
  for (const m of summary.modules) {
    const left = m.undetected ?? [];
    if (!left.length) continue;
    lines.push('');
    lines.push(`<details><summary>${m.id}: ${left.length} undetected mutant(s)</summary>`);
    lines.push('');
    lines.push('| where | mutator | replacement | status |');
    lines.push('| --- | --- | --- | --- |');
    for (const u of left.slice(0, maxSurvivedPerModule)) {
      lines.push(`| ${cell(u.where)} | ${cell(u.mutator)} | \`${cell(u.replacement)}\` | ${u.status} |`);
    }
    if (left.length > maxSurvivedPerModule) lines.push(`| … ${left.length - maxSurvivedPerModule} more in the JSON report | | | |`);
    lines.push('');
    lines.push('</details>');
  }
  lines.push('');
  return lines.join('\n');
}
