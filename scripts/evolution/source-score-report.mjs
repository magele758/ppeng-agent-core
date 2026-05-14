#!/usr/bin/env node
/**
 * Scan doc/evolution/{success,failure,skip,no-op}/ and score each source.
 *
 * Score formula:
 *   score = 2.0 * success_rate
 *         + 0.5 * proceed_rate
 *         - 1.0 * no_op_rate
 *         - 1.5 * fetch_fail_rate
 *         - 0.5 * failure_rate
 *
 * Where:
 *   proceed_rate   = (success + failure) / items_seen
 *   success_rate   = success / items_seen
 *   no_op_rate     = (skip + no_op) / items_seen
 *   fetch_fail_rate = items with failure_type: fetch_failed / items_seen
 *   failure_rate   = failure / items_seen
 *
 * CLI:
 *   node source-score-report.mjs
 *   node source-score-report.mjs --json
 *   node source-score-report.mjs --out report.json
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir    = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dir, '..', '..');

// ── YAML frontmatter parser (simple line-by-line, handles JSON-quoted values) ─
function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let val   = line.slice(colon + 1).trim();
    // Strip surrounding quotes (JSON-style or YAML-style)
    if (val.length >= 2 &&
        ((val[0] === '"' && val[val.length - 1] === '"') ||
         (val[0] === "'" && val[val.length - 1] === "'"))) {
      try { val = JSON.parse(val.startsWith('"') ? val : `"${val.slice(1, -1)}"`); }
      catch { val = val.slice(1, -1); }
    }
    out[key] = val;
  }
  return out;
}

function extractSource(fm) {
  if (fm.source && String(fm.source).trim() && fm.source !== 'null') {
    return String(fm.source).trim();
  }
  const rawUrl = fm.source_url || '';
  if (!rawUrl) return 'unknown';
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function scanDir(dir, statusLabel) {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(f => f.endsWith('.md'));
  return files.map(f => {
    const content = readFileSync(join(dir, f), 'utf8');
    const fm = parseFrontmatter(content);
    return {
      file:         f,
      status:       statusLabel,
      source:       extractSource(fm),
      failure_type: String(fm.failure_type ?? 'null').trim(),
    };
  });
}

function pct(v) { return `${Math.round(v * 1000) / 10}%`; }

function computeScores(records) {
  const buckets = new Map();
  for (const rec of records) {
    if (!buckets.has(rec.source)) {
      buckets.set(rec.source, { success: 0, failure: 0, skip: 0, no_op: 0, fetch_failed: 0 });
    }
    const b = buckets.get(rec.source);
    if      (rec.status === 'success') b.success++;
    else if (rec.status === 'failure') b.failure++;
    else if (rec.status === 'skip')    b.skip++;
    else if (rec.status === 'no-op')   b.no_op++;
    if (rec.failure_type === 'fetch_failed') b.fetch_failed++;
  }

  const rows = [];
  for (const [source, b] of buckets) {
    const n = b.success + b.failure + b.skip + b.no_op;
    if (n === 0) continue;
    const success_rate    = b.success / n;
    const proceed_rate    = (b.success + b.failure) / n;
    const no_op_rate      = (b.skip + b.no_op) / n;
    const fetch_fail_rate = b.fetch_failed / n;
    const failure_rate    = b.failure / n;
    const score = 2.0 * success_rate
                + 0.5 * proceed_rate
                - 1.0 * no_op_rate
                - 1.5 * fetch_fail_rate
                - 0.5 * failure_rate;
    rows.push({
      source,
      score:          Math.round(score * 1000) / 1000,
      items_seen:     n,
      success:        b.success,
      failure:        b.failure,
      skip:           b.skip,
      no_op:          b.no_op,
      fetch_failed:   b.fetch_failed,
      success_rate:   pct(success_rate),
      proceed_rate:   pct(proceed_rate),
      no_op_rate:     pct(no_op_rate),
      fetch_fail_rate: pct(fetch_fail_rate),
    });
  }
  rows.sort((a, b) => b.score - a.score);
  return rows;
}

function printTable(rows) {
  if (rows.length === 0) { console.log('(no data)'); return; }
  const cols = [
    'source', 'score', 'items_seen', 'success', 'failure',
    'skip', 'no_op', 'success_rate', 'proceed_rate', 'no_op_rate', 'fetch_fail_rate',
  ];
  const widths = cols.map(c =>
    Math.max(c.length, ...rows.map(r => String(r[c]).length))
  );
  const sep  = '+' + widths.map(w => '-'.repeat(w + 2)).join('+') + '+';
  const head = '|' + cols.map((c, i) => ` ${c.padEnd(widths[i])} `).join('|') + '|';
  console.log(sep);
  console.log(head);
  console.log(sep);
  for (const row of rows) {
    const line = '|' + cols.map((c, i) => ` ${String(row[c]).padEnd(widths[i])} `).join('|') + '|';
    console.log(line);
  }
  console.log(sep);
}

async function main() {
  const args     = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const outIdx   = args.indexOf('--out');
  const outFile  = outIdx !== -1 ? args[outIdx + 1] : null;

  const base    = join(repoRoot, 'doc', 'evolution');
  const records = [
    ...scanDir(join(base, 'success'), 'success'),
    ...scanDir(join(base, 'failure'), 'failure'),
    ...scanDir(join(base, 'skip'),    'skip'),
    ...scanDir(join(base, 'no-op'),   'no-op'),
  ];

  const rows = computeScores(records);

  if (jsonMode || outFile) {
    const json = JSON.stringify(rows, null, 2);
    if (outFile) {
      writeFileSync(outFile, json, 'utf8');
      if (!jsonMode) console.log(`Wrote ${outFile}`);
    }
    if (jsonMode) console.log(json);
    else printTable(rows);
  } else {
    printTable(rows);
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
