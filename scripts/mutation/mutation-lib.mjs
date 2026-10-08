/**
 * Pure helpers for the mutation gate (scripts/mutation/run-mutation.mjs): mutant generation on
 * compiled dist JS, scoring, the ratchet gate and report rendering. No process / fs side effects,
 * so scripts/test/mutation-lib.test.mjs can cover them directly.
 */
import { createHash } from 'node:crypto';
import ts from 'typescript';

export const DEFAULT_FLOOR = 60;
export const DEFAULT_TOLERANCE = 2;

export const OPERATORS = [
  'boundary',
  'equality',
  'logical',
  'negate',
  'boolean',
  'return-value',
  'remove-guard',
  'remove-call',
  'string-empty',
  'regex',
];

/** A line containing this marker excludes mutants on the next line (for documented equivalent mutants). */
export const IGNORE_MARKER = 'mutation-ignore-next-line';

const BOUNDARY = new Map([
  [ts.SyntaxKind.LessThanToken, '<='],
  [ts.SyntaxKind.LessThanEqualsToken, '<'],
  [ts.SyntaxKind.GreaterThanToken, '>='],
  [ts.SyntaxKind.GreaterThanEqualsToken, '>'],
]);
const EQUALITY = new Map([
  [ts.SyntaxKind.EqualsEqualsEqualsToken, '!=='],
  [ts.SyntaxKind.ExclamationEqualsEqualsToken, '==='],
  [ts.SyntaxKind.EqualsEqualsToken, '!='],
  [ts.SyntaxKind.ExclamationEqualsToken, '=='],
]);
const LOGICAL = new Map([
  [ts.SyntaxKind.AmpersandAmpersandToken, '||'],
  [ts.SyntaxKind.BarBarToken, '&&'],
]);
const JUMP_KINDS = new Set([
  ts.SyntaxKind.ReturnStatement,
  ts.SyntaxKind.ThrowStatement,
  ts.SyntaxKind.ContinueStatement,
  ts.SyntaxKind.BreakStatement,
]);
/** Methods whose string argument is a pattern / discriminator, so emptying it changes matching. */
const PATTERN_METHODS = new Set([
  'includes',
  'startsWith',
  'endsWith',
  'indexOf',
  'lastIndexOf',
  'split',
  'replace',
  'replaceAll',
  'match',
  'test',
  'has',
  'get',
  'RegExp',
  'Set',
]);

export function parseJs(fileName, text) {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

/** True when the text parses as JS without syntax errors (mutants must stay loadable). */
export function isSyntaxValid(fileName, text) {
  return parseJs(fileName, text).parseDiagnostics.length === 0;
}

function lineOf(sf, pos) {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

/**
 * 1-based inclusive line spans of named functions / class methods.
 * Throws when a name is missing so a rename can't silently shrink what the gate mutates.
 */
export function functionRanges(fileName, text, names) {
  const sf = parseJs(fileName, text);
  const wanted = new Set(names);
  const found = new Map();
  const visit = (node) => {
    const isFn = ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node);
    const name = isFn && node.name && ts.isIdentifier(node.name) ? node.name.text : undefined;
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

function inRanges(line, ranges) {
  return !ranges || ranges.some(([s, e]) => line >= s && line <= e);
}

function ignoredLines(text) {
  const out = new Set();
  text.split('\n').forEach((l, i) => {
    if (l.includes(IGNORE_MARKER)) out.add(i + 2);
  });
  return out;
}

function isInsideFunction(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isFunctionLike(p)) return true;
  }
  return false;
}

function isModuleSpecifier(node) {
  const p = node.parent;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p)) return true;
  return ts.isCallExpression(p) && p.expression.kind === ts.SyntaxKind.ImportKeyword;
}

function calleeName(call) {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return undefined;
}

/** Strings that act as patterns or discriminators (not messages / keys / module specifiers). */
function isPatternString(node) {
  const p = node.parent;
  if (!p || isModuleSpecifier(node)) return false;
  if (ts.isBinaryExpression(p)) return EQUALITY.has(p.operatorToken.kind);
  if (ts.isCaseClause(p) || ts.isArrayLiteralExpression(p)) return true;
  if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.arguments?.includes(node)) {
    return PATTERN_METHODS.has(calleeName(p));
  }
  return false;
}

/** Statement nested as the guard body of an `if` (directly or as a block member). */
function guardIf(stmt) {
  const p = stmt.parent;
  if (ts.isIfStatement(p)) return p.thenStatement === stmt ? p : undefined;
  if (ts.isBlock(p) && p.parent && ts.isIfStatement(p.parent) && p.parent.thenStatement === p) return p.parent;
  return undefined;
}

function isCallStatement(node) {
  if (!ts.isExpressionStatement(node)) return false;
  let e = node.expression;
  if (ts.isAwaitExpression(e) || ts.isVoidExpression(e)) e = e.expression;
  if (!ts.isCallExpression(e) || e.expression.kind === ts.SyntaxKind.SuperKeyword) return false;
  return !/^console\./.test(e.expression.getText());
}

function isTrivialReturnValue(expr) {
  const k = expr.kind;
  if (k === ts.SyntaxKind.TrueKeyword || k === ts.SyntaxKind.FalseKeyword) return true;
  return ts.isIdentifier(expr) && expr.text === 'undefined';
}

/** Candidate edits for one node: [operator, start, end, replacement]. */
function editsFor(node, sf) {
  const out = [];
  const text = sf.text;
  const span = (n) => [n.getStart(sf), n.getEnd()];
  if (ts.isBinaryExpression(node)) {
    const kind = node.operatorToken.kind;
    const [s, e] = span(node.operatorToken);
    if (BOUNDARY.has(kind)) out.push(['boundary', s, e, BOUNDARY.get(kind)]);
    if (EQUALITY.has(kind)) out.push(['equality', s, e, EQUALITY.get(kind)]);
    if (LOGICAL.has(kind)) out.push(['logical', s, e, LOGICAL.get(kind)]);
  }
  const cond = conditionOf(node);
  if (cond) {
    const [s, e] = span(cond);
    out.push(['negate', s, e, `!(${text.slice(s, e)})`]);
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    out.push(['negate', node.getStart(sf), node.operand.getStart(sf), '']);
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
    const [s, e] = span(node);
    out.push(['boolean', s, e, node.kind === ts.SyntaxKind.TrueKeyword ? 'false' : 'true']);
  }
  if (ts.isReturnStatement(node) && node.expression && guardIf(node) && !isTrivialReturnValue(node.expression)) {
    const [s, e] = span(node.expression);
    out.push(['return-value', s, e, 'undefined']);
  }
  if (JUMP_KINDS.has(node.kind) && guardIf(node)) out.push(['remove-guard', ...span(node), ';']);
  if (isCallStatement(node) && isInsideFunction(node)) out.push(['remove-call', ...span(node), ';']);
  if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text && isPatternString(node)) {
    out.push(['string-empty', ...span(node), "''"]);
  }
  if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
    const raw = node.getText(sf);
    const flags = raw.slice(raw.lastIndexOf('/') + 1);
    const [s, e] = span(node);
    out.push(['regex', s, e, `/(?!)/${flags}`], ['regex', s, e, `/(?:)/${flags}`]);
  }
  return out;
}

function conditionOf(node) {
  if (ts.isIfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) return node.expression;
  if (ts.isConditionalExpression(node)) return node.condition;
  if (ts.isForStatement(node)) return node.condition;
  return undefined;
}

export function applyMutant(text, m) {
  return text.slice(0, m.start) + m.replacement + text.slice(m.end);
}

function hashText(text) {
  return createHash('sha1').update(text).digest('hex');
}

/**
 * All mutants for a compiled JS file.
 * Options: ranges (1-based inclusive line spans to restrict to), operators (subset of OPERATORS).
 * Mutants whose result is identical to the original or to an earlier mutant are dropped.
 * Every operator is syntax-preserving; callers re-check with isSyntaxValid before running.
 */
export function generateMutants(fileName, text, { ranges, operators = OPERATORS } = {}) {
  const sf = parseJs(fileName, text);
  const wanted = new Set(operators);
  const ignored = ignoredLines(text);
  const seen = new Set([hashText(text)]);
  const mutants = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    for (const [operator, start, end, replacement] of editsFor(node, sf)) {
      const pos = sf.getLineAndCharacterOfPosition(start);
      const line = pos.line + 1;
      if (!wanted.has(operator) || ignored.has(line) || !inRanges(line, ranges)) continue;
      const m = { operator, start, end, line, column: pos.character + 1, original: text.slice(start, end), replacement };
      const mutated = applyMutant(text, m);
      const key = hashText(mutated);
      if (seen.has(key)) continue;
      seen.add(key);
      mutants.push(m);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return mutants.map((m, i) => ({ id: i + 1, ...m }));
}

/** Spread `items` evenly over `count` picks (deterministic sampling for quick local runs). */
export function sampleEvenly(items, count) {
  if (!count || count >= items.length) return items;
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(items[Math.floor((i * items.length) / count)]);
  return out;
}

const STATUS_KEYS = { killed: 'killed', timeout: 'timeout', survived: 'survived', 'no-coverage': 'noCoverage' };

/**
 * score = (killed + timeout) / (killed + timeout + survived + noCoverage).
 * `error` mutants (do not parse / could not spawn) are invalid and excluded.
 */
export function scoreResults(results) {
  const counts = { total: results.length, killed: 0, timeout: 0, survived: 0, noCoverage: 0, error: 0 };
  for (const r of results) counts[STATUS_KEYS[r.status] ?? 'error'] += 1;
  const detected = counts.killed + counts.timeout;
  const valid = detected + counts.survived + counts.noCoverage;
  counts.score = valid === 0 ? null : Math.floor((detected / valid) * 10000) / 100;
  return counts;
}

export function isUndetected(status) {
  return status === 'survived' || status === 'no-coverage';
}

/** Module summary from raw per-mutant results (also used to merge shard reports). */
export function summarizeModule({ id, description, results, durationMs }) {
  const sorted = [...results].sort((a, b) => a.file.localeCompare(b.file) || a.distLine - b.distLine || a.id - b.id);
  const survivors = sorted.filter((r) => isUndetected(r.status));
  return { id, description, ...scoreResults(sorted), durationMs, survivors, results: sorted };
}

/** True when V8 block coverage (per-character paint, 1 = executed) ran any part of the mutated span. */
export function isCovered(paint, m) {
  if (!paint) return true;
  const end = Math.max(m.end, m.start + 1);
  for (let i = m.start; i < end && i < paint.length; i += 1) if (paint[i]) return true;
  return false;
}

export function parseShard(raw) {
  if (raw === undefined) return undefined;
  const m = /^(\d+)\/(\d+)$/.exec(String(raw));
  if (!m) throw new Error(`--shard must look like 1/3, got ${raw}`);
  const index = Number(m[1]);
  const count = Number(m[2]);
  if (index < 1 || index > count) throw new Error(`--shard index out of range: ${raw}`);
  return { index, count };
}

/** Interleaved slice so every shard gets a similar mix of cheap and expensive mutants. */
export function shardMutants(mutants, shard) {
  if (!shard || shard.count <= 1) return mutants;
  return mutants.filter((_, i) => i % shard.count === shard.index - 1);
}

/** Merge shard reports: per module, results are concatenated and the summary recomputed. */
export function mergeModuleReports(reports) {
  const byId = new Map();
  for (const report of reports) {
    for (const m of report.modules ?? []) {
      const slot = byId.get(m.id) ?? { id: m.id, description: m.description, results: [], durationMs: 0 };
      slot.results.push(...(m.results ?? []));
      slot.durationMs = Math.max(slot.durationMs, m.durationMs ?? 0);
      byId.set(m.id, slot);
    }
  }
  return [...byId.values()].map(summarizeModule);
}

/** Exit code / timeout of a test child → mutant status. */
export function classifyRun({ timedOut, code, signal, spawnError }) {
  if (spawnError) return 'error';
  if (timedOut) return 'timeout';
  if (code === 0 && !signal) return 'survived';
  return 'killed';
}

/** Kill timeout for one mutant run: a generous multiple of the clean run so CPU contention doesn't misfire. */
export function mutantTimeoutMs(cleanMs, { factor = 4, minMs = 10000 } = {}) {
  return Math.max(minMs, Math.ceil(cleanMs * factor) + 3000);
}

/**
 * Ratchet gate. A module in the baseline may not fall more than `tolerance` points below it;
 * a module missing from the baseline must reach `floor`. A module without valid mutants fails
 * (it means the config points at code the tests never load).
 */
export function evaluateGate(modules, baseline, { floor = DEFAULT_FLOOR, tolerance = DEFAULT_TOLERANCE } = {}) {
  const rows = modules.map((m) => {
    const base = baseline?.modules?.[m.id]?.score;
    const required = typeof base === 'number' ? Math.max(0, base - tolerance) : floor;
    let reason = '';
    if (m.score === null) reason = 'no valid mutants';
    else if (m.score < required) reason = typeof base === 'number' ? `below baseline ${base} - ${tolerance}` : `below floor ${floor}`;
    return { ...m, baseline: typeof base === 'number' ? base : null, required, pass: reason === '', reason };
  });
  return { pass: rows.every((r) => r.pass), modules: rows };
}

/**
 * New baseline from a run. Scores only move up unless `allowDecrease`; modules not in this run
 * keep their old entry (a partial `--module` run must not drop the others).
 */
export function updateBaseline(prev, modules, { allowDecrease = false } = {}) {
  const next = { version: 1, modules: { ...(prev?.modules ?? {}) } };
  const changes = [];
  for (const m of modules) {
    if (m.score === null) continue;
    const old = next.modules[m.id]?.score;
    const score = Math.floor(m.score * 10) / 10;
    if (typeof old === 'number' && score <= old && !allowDecrease) continue;
    if (old === score) continue;
    next.modules[m.id] = { score, mutants: m.total };
    changes.push({ id: m.id, from: old ?? null, to: score });
  }
  return { baseline: next, changes };
}

function cell(text, max = 70) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  const cut = flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
  return cut.replace(/\|/g, '\\|').replace(/`/g, "'");
}

function fmtScore(score) {
  return score === null ? 'n/a' : `${score.toFixed(2)}%`;
}

export function renderMarkdown(gate, { maxSurvivedPerModule = 60 } = {}) {
  const lines = [`## Mutation testing: ${gate.pass ? 'PASS' : 'FAIL'}`, ''];
  lines.push('| module | mutants | killed | timeout | survived | no cov | invalid | score | baseline | required | time |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const m of gate.modules) {
    const mark = m.pass ? '' : ` ❌ ${m.reason}`;
    const base = m.baseline === null ? 'new' : `${m.baseline}%`;
    const time = m.durationMs ? `${Math.round(m.durationMs / 1000)}s` : '';
    lines.push(
      `| ${m.id}${mark} | ${m.total} | ${m.killed} | ${m.timeout} | ${m.survived} | ${m.noCoverage} | ${m.error} | ${fmtScore(m.score)} | ${base} | ${m.required}% | ${time} |`,
    );
  }
  for (const m of gate.modules) {
    const left = m.survivors ?? [];
    if (!left.length) continue;
    lines.push('', `<details><summary>${m.id}: ${left.length} undetected mutant(s)</summary>`, '');
    lines.push('| where | operator | original → mutated | status |', '| --- | --- | --- | --- |');
    for (const s of left.slice(0, maxSurvivedPerModule)) {
      lines.push(`| \`${s.where}\` | ${s.operator} | \`${cell(s.original)}\` → \`${cell(s.replacement)}\` | ${s.status} |`);
    }
    if (left.length > maxSurvivedPerModule) lines.push(`| … ${left.length - maxSurvivedPerModule} more in mutation-report.json | | | |`);
    lines.push('', '</details>');
  }
  lines.push('');
  return lines.join('\n');
}
