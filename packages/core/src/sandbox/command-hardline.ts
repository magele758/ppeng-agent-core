/**
 * Builtin catastrophic-command hardline.
 *
 * Checked before bash / bg_run spawn and before every sandbox backend
 * (native, remote VM, microservice). permissionMode bypass / auto cannot
 * skip it, and container backends must not skip it either.
 *
 * Matching is by shell command-word position. Text inside quotes is an
 * argument, not a command (`git commit -m "rm -rf /"` is allowed).
 * Within one command string, literal variable assignments, `cd`, `alias` and
 * function definitions are tracked so `r=rm; $r -rf /`, `cd / && rm -rf .` and
 * `f() { rm -rf /; }; f` resolve. Function calls and `sh -c 'script' name args...` bind
 * positional parameters (`$1`, `$@`, `${1:-/}`) from literal arguments. Command substitutions
 * that are a single `echo` / `printf` of literal words and `for` loops over a literal word list
 * are expanded the same way. Nothing is executed and anything that is not a
 * plain literal stays unknown (and therefore allowed). The one deliberate exception is
 * `bash -c` / `eval` nesting deeper than MAX_SHELL_NESTING, which cannot be inspected and is refused.
 * There is no user deny-list yet — extend the constants below.
 */

import { homedir } from 'node:os';
import type { AgentSandboxExecResult, AgentSandboxKind } from './agent-sandbox-types.js';

/** Exact directories whose recursive removal is refused. Extend in code. */
export const HARDLINE_RM_SYSTEM_DIRS = [
  '/home',
  '/root',
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/lib',
  '/lib32',
  '/lib64',
  '/boot',
  '/var',
  '/dev',
  '/sys',
  '/proc',
  '/opt',
  '/srv',
  '/usr/bin',
  '/usr/sbin',
  '/usr/lib',
  '/usr/lib64',
  '/Users',
  '/System',
  '/Library'
] as const;

export const HARDLINE_POWER_COMMANDS = ['shutdown', 'reboot', 'halt', 'poweroff'] as const;

export const HARDLINE_ERROR_CODE = 'COMMAND_HARDLINE' as const;

/** Refusal exit status returned when a backend is asked to run a blocked command. */
export const HARDLINE_EXIT_CODE = 126;

const HARDLINE_HINT =
  'Blocked before execution by the builtin command hardline. ' +
  'permissionMode bypass/auto and container or remote sandboxes cannot override this.';

const MAX_SCAN_DEPTH = 8;

/**
 * Deepest chain of `bash -c` / `eval` / piped-to-shell scripts that is still inspected. Shell layers do not
 * consume MAX_SCAN_DEPTH (function, alias and substitution recursion does), so the body of the last
 * permitted layer is scanned like any other; one layer more is refused instead of silently skipped.
 */
const MAX_SHELL_NESTING = MAX_SCAN_DEPTH + 1;

/**
 * Stands in for a command / process substitution whose output is not a plain literal. It contains
 * `$`, so no path classifier treats the word as a concrete path, and it keeps the word from
 * vanishing (`cd $(mktemp -d)` must not turn into a bare `cd`).
 */
const UNKNOWN_SUBSTITUTION = '$(?)';

const SHELLS = new Set(['bash', 'sh', 'dash', 'zsh', 'ksh', 'ash', 'fish']);

const FORK_BOMB_OPEN = /\( ?\) ?\{ ?/g;
const FUNCTION_NAME_CHAR = /[\w:.@%+-]/;

/** Longest expanded word the variable resolver keeps; longer results stay unknown (unexpanded). */
const MAX_EXPANDED_LENGTH = 4096;

const BLOCK_DEVICE = /^\/dev\/(?:nvme|mmcblk|xvd|sd|hd|vd|disk|rdisk|dm-|md\d|mapper\/|loop)/;

/** Reserved words that may precede a command in the same command position. */
const RESERVED_PREFIX = new Set(['if', 'then', 'elif', 'else', 'do', 'while', 'until', '!', 'time', 'coproc']);

export type CommandHardlineRuleId =
  | 'rm-root'
  | 'rm-system-dir'
  | 'rm-home'
  | 'mkfs'
  | 'dd-raw-device'
  | 'fork-bomb'
  | 'power'
  | 'init-runlevel'
  | 'systemctl-power'
  | 'kill-minus-one'
  | 'raw-device-write'
  | 'wipe-device'
  | 'proc-write'
  | 'recursive-perm'
  | 'root-perm'
  | 'mv-system'
  | 'nesting-depth';

export interface CommandHardlineMatch {
  ruleId: CommandHardlineRuleId;
  reason: string;
}

interface ShellWord {
  text: string;
  /** Entirely single-quoted, so ~ and $HOME are literal filenames. */
  literal: boolean;
  /** Contained a command substitution whose output is missing from `text`. */
  dynamic?: boolean;
}

interface ShellCommand {
  words: ShellWord[];
  /** Here-string / heredoc bodies fed to this command's stdin. */
  stdin: string[];
  /** Previous pipeline stage, whose output becomes this command's stdin. */
  upstream: ShellCommand | null;
  /** Targets of output redirections (`>`, `>>`, `>|`, `&>`), quotes removed. */
  redirects: string[];
  /** Nesting depth of `( )` groups, whose variable / cwd effects do not leak out. */
  depth: number;
  /** Feeds a later pipeline stage. */
  pipeOut: boolean;
  /** Terminated by a single `&`. */
  async: boolean;
  /** Runs only when the previous command failed (`a || this`). */
  afterOr: boolean;
  /** `name() { body; }` definition: the body runs only when the function is called. */
  def?: { name: string; body: string };
}

interface LexResult {
  commands: ShellCommand[];
  subs: string[];
}

let warnedResourceExhaustion = false;

export function matchCommandHardline(command: string): CommandHardlineMatch | null {
  if (!command || !command.trim()) return null;
  try {
    return scanSource(command, 0);
  } catch (error) {
    // Resource exhaustion (stack overflow on pathological nesting) must not abort the whole turn.
    // Anything else is a real defect and still propagates.
    if (!(error instanceof RangeError)) throw error;
    if (!warnedResourceExhaustion) {
      warnedResourceExhaustion = true;
      console.warn(`[command-hardline] scan aborted (${error.message}); command not blocked by hardline`);
    }
    return null;
  }
}

function forkBombBodyAt(s: string, from: number, name: string): boolean {
  let pos = from;
  const token = (text: string): boolean => {
    if (s[pos] === ' ') pos += 1;
    if (!s.startsWith(text, pos)) return false;
    pos += text.length;
    return true;
  };
  return token(name) && token('|') && token(name) && token('&') && token('}') && token(';') && token(name);
}

/**
 * `f(){ f|f& };f` in any function name, including the classic `:`.
 * Linear scan: whitespace runs collapse to one space, each `(){` is checked once against the name
 * that precedes it, so there is no backtracking on adversarial input.
 */
function containsForkBomb(text: string): boolean {
  if (!text.includes('(')) return false;
  const s = text.replace(/\s+/g, ' ');
  FORK_BOMB_OPEN.lastIndex = 0;
  for (let open = FORK_BOMB_OPEN.exec(s); open !== null; open = FORK_BOMB_OPEN.exec(s)) {
    let end = open.index;
    if (s[end - 1] === ' ') end -= 1;
    let start = end;
    while (start > 0 && FUNCTION_NAME_CHAR.test(s[start - 1] ?? '')) start -= 1;
    if (start === end) continue;
    if (forkBombBodyAt(s, open.index + open[0].length, s.slice(start, end))) return true;
  }
  return false;
}

/** Tools whose input carries a shell command string that a sandbox will run. */
const HARDLINE_TOOL_COMMAND_FIELDS: Readonly<Record<string, string>> = {
  bash: 'command',
  bg_run: 'command',
  work_evidence: 'verify_command'
};

export const HARDLINE_SIBLING_SKIPPED_CODE = 'COMMAND_HARDLINE_SIBLING_SKIPPED' as const;

/** Command string a tool call would execute, or undefined for tools that do not run shell commands. */
export function hardlineCommandOfToolCall(toolName: string, input: unknown): string | undefined {
  const field = HARDLINE_TOOL_COMMAND_FIELDS[toolName];
  if (!field || typeof input !== 'object' || input === null) return undefined;
  const value = (input as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
}

export function formatCommandHardlineContent(match: CommandHardlineMatch): string {
  return JSON.stringify({
    error: match.reason,
    error_code: HARDLINE_ERROR_CODE,
    rule_id: match.ruleId,
    hint: HARDLINE_HINT
  });
}

export function commandHardlineToolResult(command: string): {
  ok: false;
  content: string;
  metadata: { hardline: true; ruleId: CommandHardlineRuleId };
} | null {
  const match = matchCommandHardline(command);
  if (!match) return null;
  return {
    ok: false,
    content: formatCommandHardlineContent(match),
    metadata: { hardline: true, ruleId: match.ruleId }
  };
}

export class CommandHardlineDeniedError extends Error {
  readonly ruleId: CommandHardlineRuleId;
  readonly payload: string;

  constructor(match: CommandHardlineMatch) {
    const payload = formatCommandHardlineContent(match);
    super(payload);
    this.name = 'CommandHardlineDeniedError';
    this.ruleId = match.ruleId;
    this.payload = payload;
  }
}

/** Synthetic sandbox result. Callers must return this instead of spawning. */
export function commandHardlineSandboxResult(
  command: string,
  kind: AgentSandboxKind
): AgentSandboxExecResult | null {
  const match = matchCommandHardline(command);
  if (!match) return null;
  return {
    stdout: '',
    stderr: formatCommandHardlineContent(match),
    code: HARDLINE_EXIT_CODE,
    signal: null,
    kind,
    backend: 'command-hardline'
  };
}

export function commandHardlineProcessRefusal(command: string): { code: number; stderr: string } | null {
  const match = matchCommandHardline(command);
  if (!match) return null;
  return { code: HARDLINE_EXIT_CODE, stderr: formatCommandHardlineContent(match) };
}

interface ScanEnv {
  vars: ReadonlyMap<string, string>;
  cwd: string | null;
  aliases?: ReadonlyMap<string, string>;
  functions?: ReadonlyMap<string, string>;
  expansions?: { left: number };
  /** `bash -c` / `eval` layers entered so far. */
  nesting?: number;
}

const EMPTY_ENV: ScanEnv = { vars: new Map(), cwd: null };

/** Literal shell state inside one command string. `cwd` is null until a `cd` makes it known. */
interface ScanState {
  vars: Map<string, string>;
  exported: Set<string>;
  cwd: string | null;
  aliases: Map<string, string>;
  functions: Map<string, string>;
  /** Alias / function expansions still allowed, shared by every nested scan of one command string. */
  expansions: { left: number };
  /** `bash -c` / `eval` layers entered so far; constant within one scanned source. */
  nesting: number;
}

function newScanState(env: ScanEnv): ScanState {
  return {
    vars: new Map(env.vars),
    exported: new Set(env.vars.keys()),
    cwd: env.cwd,
    aliases: new Map(env.aliases),
    functions: new Map(env.functions),
    expansions: env.expansions ?? { left: MAX_ALIAS_FUNCTION_EXPANSIONS },
    nesting: env.nesting ?? 0
  };
}

function snapshotState(state: ScanState): ScanState {
  return {
    vars: new Map(state.vars),
    exported: new Set(state.exported),
    cwd: state.cwd,
    aliases: new Map(state.aliases),
    functions: new Map(state.functions),
    expansions: state.expansions,
    nesting: state.nesting
  };
}

/**
 * Cap on literal loop iterations expanded per scanned source, so nested loops cannot blow up.
 * When a cap is exhausted the loop / call is simply not replayed (allowed, not refused): long literal
 * lists are ordinary in deployment scripts.
 */
const MAX_LOOP_EXPANSIONS = 512;
const MAX_LOOP_WORDS = 256;
const MAX_ALIAS_FUNCTION_EXPANSIONS = 128;

interface ScanContext {
  depth: number;
  expansions: number;
}

function scanSource(source: string, depth: number, env: ScanEnv = EMPTY_ENV): CommandHardlineMatch | null {
  if (depth > MAX_SCAN_DEPTH) return null;
  if (containsForkBomb(unquotedText(source))) {
    return { ruleId: 'fork-bomb', reason: 'fork bomb' };
  }
  const lex = lexShell(source);
  const hit = scanCommandList(lex.commands, newScanState(env), { depth, expansions: 0 }, new Map());
  if (hit) return hit;
  for (const sub of lex.subs) {
    const subHit = scanSource(sub, depth + 1, env);
    if (subHit) return subHit;
  }
  return null;
}

/** Walk commands in order, mutating `state`. Literal `for` loops are replayed once per list item. */
function scanCommandList(
  commands: readonly ShellCommand[],
  state: ScanState,
  ctx: ScanContext,
  resolved: Map<ShellCommand, ShellCommand>,
  baseDepth = 0
): CommandHardlineMatch | null {
  let current = state;
  const scopes: ScanState[] = [];
  for (let index = 0; index < commands.length; index += 1) {
    const raw = commands[index];
    if (!raw) continue;
    const level = Math.max(0, raw.depth - baseDepth);
    while (scopes.length > level) current = scopes.pop() ?? current;
    while (scopes.length < level) {
      scopes.push(current);
      current = snapshotState(current);
    }
    if (raw.def) {
      if (!raw.afterOr) current.functions.set(raw.def.name, raw.def.body);
      continue;
    }
    const command = resolveCommand(raw, current, resolved);
    resolved.set(raw, command);
    const loop = literalForLoop(commands, index, command, raw.depth);
    if (loop) {
      const expanded = expandForLoop(loop, current, ctx, resolved);
      if (expanded.hit) return expanded.hit;
      if (expanded.ran) {
        index = loop.doneIndex;
        continue;
      }
    }
    const hit = matchCommand(command, ctx.depth, current);
    if (hit) return hit;
    applyEffects(raw, command, current);
  }
  return null;
}

function copyState(from: ScanState, to: ScanState): void {
  if (from === to) return;
  to.vars = from.vars;
  to.exported = from.exported;
  to.cwd = from.cwd;
  to.aliases = from.aliases;
  to.functions = from.functions;
}

const LOOP_OPENERS = new Set(['for', 'while', 'until', 'select']);

/** Number of loop keywords that open a block at the start of this command (`do for x in a`, `while cond`). */
function loopOpeners(words: readonly ShellWord[]): number {
  let opened = 0;
  for (const word of words) {
    if (!RESERVED_PREFIX.has(word.text) && !LOOP_OPENERS.has(word.text)) break;
    if (LOOP_OPENERS.has(word.text)) opened += 1;
    if (word.text === 'for' || word.text === 'select') break;
  }
  return opened;
}

interface LiteralForLoop {
  name: string;
  items: string[];
  body: readonly ShellCommand[];
  doneIndex: number;
  baseDepth: number;
}

/**
 * `for NAME in w1 w2 ...; do ...; done` where every list word is a plain literal.
 * Globs, braces, substitutions and unresolved variables keep the loop unknown.
 */
function literalForLoop(
  commands: readonly ShellCommand[],
  index: number,
  header: ShellCommand,
  baseDepth: number
): LiteralForLoop | null {
  if (header.pipeOut || header.upstream !== null || header.async) return null;
  const at = findHeadIndex(header.words);
  if (header.words[at]?.text !== 'for') return null;
  const name = header.words[at + 1]?.text;
  if (name === undefined || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || header.words[at + 2]?.text !== 'in') {
    return null;
  }
  const list = header.words.slice(at + 3);
  if (list.length > MAX_LOOP_WORDS || !list.every(isPlainLoopWord)) return null;
  if (commands[index + 1]?.words[0]?.text !== 'do') return null;
  let nesting = 1;
  for (let j = index + 1; j < commands.length; j += 1) {
    const words = commands[j]?.words ?? [];
    nesting += loopOpeners(words);
    if (words[0]?.text === 'done') nesting -= 1;
    if (nesting === 0) {
      return {
        name,
        items: list.map((word) => word.text),
        body: commands.slice(index + 1, j),
        doneIndex: j,
        baseDepth
      };
    }
  }
  return null;
}

function isPlainLoopWord(word: ShellWord): boolean {
  if (word.dynamic) return false;
  const text = word.text;
  if (text.includes('$') || text.includes('`')) return false;
  if (word.literal) return true;
  return !/[*?[{}]/.test(text) && !text.startsWith('~');
}

function expandForLoop(
  loop: LiteralForLoop,
  state: ScanState,
  ctx: ScanContext,
  resolved: Map<ShellCommand, ShellCommand>
): { hit: CommandHardlineMatch | null; ran: boolean } {
  if (ctx.expansions + loop.items.length > MAX_LOOP_EXPANSIONS) return { hit: null, ran: false };
  ctx.expansions += loop.items.length;
  let last: ScanState | null = null;
  for (const item of loop.items) {
    const iteration = snapshotState(state);
    iteration.vars.set(loop.name, item);
    const hit = scanCommandList(loop.body, iteration, ctx, resolved, loop.baseDepth);
    if (hit) return { hit, ran: true };
    last = iteration;
  }
  if (last) copyState(last, state);
  else state.vars.delete(loop.name);
  return { hit: null, ran: true };
}

/**
 * Expand literal `$VAR` / `${VAR}` / `${VAR:-default}`. HOME stays symbolic.
 * `null` = unresolved (strict only), or the result outgrew MAX_EXPANDED_LENGTH (always), in which
 * case the caller keeps the word unexpanded and therefore unknown.
 */
function expandText(text: string, vars: ReadonlyMap<string, string>, strict: boolean): string | null {
  if (!text.includes('$')) return text;
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (out.length > MAX_EXPANDED_LENGTH) return null;
    const ch = text[i] ?? '';
    if (ch !== '$') {
      out += ch;
      i += 1;
      continue;
    }
    if (text[i + 1] === '{') {
      const end = findMatchingBrace(text, i + 1);
      const value = text[end] === '}' ? expandBraced(text.slice(i + 2, end), vars, strict) : null;
      if (value === null) {
        if (strict) return null;
        out += text.slice(i, end + 1);
      } else {
        out += value;
      }
      i = end + 1;
      continue;
    }
    const name = /^(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]|[#@*])/.exec(text.slice(i + 1))?.[0];
    if (name === undefined) {
      if (strict) return null;
      out += '$';
      i += 1;
      continue;
    }
    const value = variableValue(name, vars);
    if (value === null) {
      if (strict) return null;
      out += `$${name}`;
    } else {
      out += value;
    }
    i += 1 + name.length;
  }
  return out.length > MAX_EXPANDED_LENGTH ? null : out;
}

/**
 * Positional parameters live in the same map as variables under keys `1`..`n`, `#`, `@`, `*` (and `0`
 * for `sh -c`). They only exist while a function call or `sh -c` has bound them (`#` marks that).
 */
const POSITIONAL_COUNT_KEY = '#';
const POSITIONAL_INDEX = /^[1-9][0-9]*$/;

function isPositionalKey(name: string): boolean {
  return POSITIONAL_INDEX.test(name) || name === POSITIONAL_COUNT_KEY || name === '@' || name === '*';
}

/** Parameter names that are not identifiers: `$1`, `${10}`, `$#`, `$@`, `$*`, `$0`. */
function isSpecialParameter(name: string): boolean {
  return name === '0' || isPositionalKey(name);
}

function variableValue(name: string, vars: ReadonlyMap<string, string>): string | null {
  if (name === 'HOME') return '$HOME';
  if (POSITIONAL_INDEX.test(name)) return vars.get(name) ?? (vars.has(POSITIONAL_COUNT_KEY) ? '' : null);
  return vars.get(name) ?? null;
}

function expandBraced(body: string, vars: ReadonlyMap<string, string>, strict: boolean): string | null {
  const match = /^([A-Za-z_][A-Za-z0-9_]*|[0-9]+|[#@*])(?:(:?[-=])([\s\S]*))?$/.exec(body);
  if (!match) return null;
  const name = match[1] ?? '';
  const op = match[2];
  if (op === undefined) return variableValue(name, vars);
  if (name === 'HOME') return '$HOME';
  if (isSpecialParameter(name) && !vars.has(name) && !vars.has(POSITIONAL_COUNT_KEY)) return null;
  const set = vars.get(name);
  if (set !== undefined && !(op.startsWith(':') && set === '')) return set;
  const fallback = match[3] ?? '';
  if (fallback === '') return null;
  return expandText(fallback, vars, strict);
}

function resolveCommand(
  raw: ShellCommand,
  state: ScanState,
  resolved: ReadonlyMap<ShellCommand, ShellCommand>
): ShellCommand {
  const words: ShellWord[] = [];
  let headSeen = false;
  for (const word of raw.words) {
    const assignment = isAssignment(word.text);
    const spread = spreadPositionals(word, state.vars);
    if (spread !== null) {
      for (const text of spread) words.push({ text, literal: false });
      headSeen = true;
      continue;
    }
    const expanded = word.literal || word.dynamic ? null : expandText(word.text, state.vars, false);
    if (expanded === null || expanded === word.text) {
      words.push(word);
    } else if (!headSeen && !assignment && /\s/.test(expanded.trim())) {
      for (const part of expanded.trim().split(/\s+/)) words.push({ text: part, literal: false });
    } else {
      words.push({ text: expanded, literal: false });
    }
    if (!assignment) headSeen = true;
  }
  return {
    ...raw,
    words,
    stdin: raw.stdin.map((body) => expandText(body, state.vars, false) ?? body),
    redirects: raw.redirects.map((target) => expandText(target, state.vars, false) ?? target),
    upstream: raw.upstream ? (resolved.get(raw.upstream) ?? raw.upstream) : null
  };
}

/** `$@` / `$*` as a whole word: one word per bound positional parameter (none when there are none). */
function spreadPositionals(word: ShellWord, vars: ReadonlyMap<string, string>): string[] | null {
  if (word.literal || word.dynamic || !/^\$(?:[@*]|\{[@*]\})$/.test(word.text)) return null;
  const count = vars.get(POSITIONAL_COUNT_KEY);
  if (count === undefined) return null;
  const out: string[] = [];
  for (let n = 1; n <= Number(count); n += 1) out.push(vars.get(String(n)) ?? '');
  return out;
}

const ALIAS_NAME = /^[A-Za-z0-9_.:@%+,-]+$/;
const ASSIGN_BUILTINS = new Set(['export', 'declare', 'typeset', 'local', 'readonly']);
/** Builtins whose non-option operands become variables with unknown values. */
const CLOBBER_BUILTINS = new Set(['read', 'mapfile', 'readarray', 'getopts', 'unset', 'for', 'select']);

/** Text a word hands to a positional parameter. Literal text that a later expansion could reinterpret stays unknown. */
function positionalText(word: ShellWord): string {
  if (word.literal && (word.text.includes('$') || word.text.includes('`') || word.text.startsWith('~'))) {
    return UNKNOWN_SUBSTITUTION;
  }
  return word.text;
}

function clearPositionals(vars: Map<string, string>): void {
  for (const name of [...vars.keys()]) {
    if (isPositionalKey(name)) vars.delete(name);
  }
}

function bindPositionals(vars: Map<string, string>, args: readonly string[]): void {
  clearPositionals(vars);
  vars.set(POSITIONAL_COUNT_KEY, String(args.length));
  vars.set('@', args.join(' '));
  vars.set('*', args.join(' '));
  args.forEach((arg, index) => vars.set(String(index + 1), arg));
}

function boundPositionals(vars: ReadonlyMap<string, string>): string[] | null {
  const count = vars.get(POSITIONAL_COUNT_KEY);
  if (count === undefined) return null;
  return Array.from({ length: Number(count) }, (_, index) => vars.get(String(index + 1)) ?? '');
}

function applyShift(args: readonly ShellWord[], unknown: boolean, vars: Map<string, string>): void {
  const bound = boundPositionals(vars);
  if (bound === null) return;
  const operand = args[0]?.text;
  const amount = operand === undefined ? 1 : /^\d+$/.test(operand) ? Number(operand) : null;
  if (unknown || amount === null) {
    clearPositionals(vars);
    return;
  }
  if (amount <= bound.length) bindPositionals(vars, bound.slice(amount));
}

/** `set -- a b` rebinds the positional parameters; other `set` forms leave them alone. */
function applySet(args: readonly ShellWord[], unknown: boolean, vars: Map<string, string>): void {
  if (args[0]?.text !== '--') return;
  if (unknown) clearPositionals(vars);
  else bindPositionals(vars, args.slice(1).map(positionalText));
}

function applyEffects(raw: ShellCommand, command: ShellCommand, state: ScanState): void {
  if (raw.pipeOut || raw.upstream !== null || raw.async) return;
  const argv = command.words;
  if (argv.length > 0 && argv.every((word) => isAssignment(word.text))) {
    for (const word of argv) assignVariable(word.text, word.dynamic === true || raw.afterOr, state, false);
    return;
  }
  const index = findHeadIndex(argv);
  const head = argv[index];
  if (!head) return;
  const cmd = basename(head.text).toLowerCase();
  const args = argv.slice(index + 1);
  if (ASSIGN_BUILTINS.has(cmd)) {
    const exporting = cmd === 'export' || (args.some((word) => /^-[A-Za-z]*x/.test(word.text)) && cmd !== 'local');
    for (const word of args) {
      if (isAssignment(word.text)) assignVariable(word.text, word.dynamic === true || raw.afterOr, state, exporting);
      else if (exporting && /^[A-Za-z_][A-Za-z0-9_]*$/.test(word.text)) state.exported.add(word.text);
    }
    return;
  }
  if (cmd === 'alias') {
    for (const word of args) {
      const eq = word.text.indexOf('=');
      const name = word.text.slice(0, eq);
      if (eq <= 0 || !ALIAS_NAME.test(name)) continue;
      if (word.dynamic === true || raw.afterOr) state.aliases.delete(name);
      else state.aliases.set(name, word.text.slice(eq + 1));
    }
    return;
  }
  if (cmd === 'unalias') {
    if (args.some((word) => word.text === '-a')) state.aliases.clear();
    for (const word of args) state.aliases.delete(word.text);
    return;
  }
  if (cmd === 'shift') {
    applyShift(args, raw.afterOr, state.vars);
    return;
  }
  if (cmd === 'set') {
    applySet(args, raw.afterOr, state.vars);
    return;
  }
  if (cmd === 'unset' && args.some((word) => word.text === '-f')) {
    for (const word of args) state.functions.delete(word.text);
    return;
  }
  if (CLOBBER_BUILTINS.has(cmd)) {
    for (const word of args) {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(word.text)) state.vars.delete(word.text);
    }
    return;
  }
  if (cmd === 'printf') {
    const at = args.findIndex((word) => word.text === '-v');
    const name = args[at + 1]?.text;
    if (at >= 0 && name) state.vars.delete(name);
    return;
  }
  if (cmd === 'cd' || cmd === 'pushd') {
    state.cwd = raw.afterOr ? null : cdTarget(args, state.cwd);
    return;
  }
  if (cmd === 'popd') state.cwd = null;
}

function assignVariable(text: string, unknown: boolean, state: ScanState, exporting: boolean): void {
  const eq = text.indexOf('=');
  const name = text.slice(0, eq);
  const value = text.slice(eq + 1);
  if (unknown || name === 'HOME' || value.includes('$')) {
    state.vars.delete(name);
  } else {
    state.vars.set(name, value);
  }
  if (exporting) state.exported.add(name);
}

function hostHomeDir(): string | null {
  for (const raw of [process.env.HOME, safeHomedir()]) {
    const norm = raw ? normalizeAbsPath(raw) : null;
    if (norm && norm !== '/') return norm;
  }
  return null;
}

/** New cwd after `cd <args>`, or null when it cannot be known. */
function cdTarget(args: ShellWord[], cwd: string | null): string | null {
  const word = args.find((arg) => arg.text !== '--' && !(arg.text.startsWith('-') && arg.text !== '-'));
  const target = word?.text;
  if (target === undefined) return hostHomeDir();
  if (word?.dynamic) return null;
  if (target === '') return cwd;
  if (target === '-' || target.includes('`') || target.includes('*') || target.includes('?')) return null;
  const home = /^(?:~|\$HOME|\$\{HOME\})(\/.*)?$/.exec(target);
  if (home) {
    const base = hostHomeDir();
    return base === null ? null : normalizeAbsPath(`${base}${home[1] ?? ''}`);
  }
  if (target.includes('$') || target.startsWith('~')) return null;
  if (target.startsWith('/')) return normalizeAbsPath(target);
  return cwd === null ? null : normalizeAbsPath(joinPath(cwd, target));
}

function joinPath(cwd: string, relative: string): string {
  return `${cwd}/${relative}`;
}

function isRelativeOperand(text: string): boolean {
  return text !== '' && !text.startsWith('/') && !text.startsWith('~') && !text.startsWith('$');
}

function findHeadIndex(argv: ShellWord[]): number {
  let i = 0;
  for (;;) {
    while (i < argv.length && isAssignment(argv[i]?.text ?? '')) i += 1;
    // `time` also takes options (`time -p`, `/usr/bin/time -f fmt`), so skipWrappers owns it.
    const word = argv[i]?.text ?? '';
    if (i < argv.length && RESERVED_PREFIX.has(word) && word !== 'time') {
      i += 1;
      continue;
    }
    const next = skipWrappers(argv, i);
    if (next === i) return i;
    i = next;
  }
}

function commandHeadOf(words: ShellWord[]): { cmd: string; args: ShellWord[] } | null {
  const index = findHeadIndex(words);
  const head = words[index];
  if (!head) return null;
  return { cmd: basename(head.text).toLowerCase(), args: words.slice(index + 1) };
}

interface ParamBinding {
  /** `$0`; only a fresh `sh -c` has one. */
  zero?: string;
  args: readonly string[];
}

/**
 * State a child shell starts with: everything for `eval`, only exported / prefix variables for `sh -c`.
 * Positional parameters are never inherited by a fresh shell; `params` binds new ones (function call, `sh -c`).
 */
function childEnv(
  state: ScanState,
  prefix: ShellWord[],
  all: boolean,
  skipAlias?: string,
  params?: ParamBinding
): ScanEnv {
  const vars = new Map<string, string>();
  for (const [name, value] of state.vars) {
    if (all || (state.exported.has(name) && !isSpecialParameter(name))) vars.set(name, value);
  }
  if (params) {
    bindPositionals(vars, params.args);
    if (params.zero !== undefined) vars.set('0', params.zero);
  }
  for (const word of prefix) {
    if (!isAssignment(word.text)) continue;
    const eq = word.text.indexOf('=');
    const value = word.text.slice(eq + 1);
    if (!value.includes('$')) vars.set(word.text.slice(0, eq), value);
  }
  const nesting = state.nesting;
  if (!all) return { vars, cwd: state.cwd, nesting };
  const aliases = new Map(state.aliases);
  if (skipAlias !== undefined) aliases.delete(skipAlias);
  return { vars, cwd: state.cwd, aliases, functions: state.functions, expansions: state.expansions, nesting };
}

const NESTING_DEPTH_HIT: CommandHardlineMatch = {
  ruleId: 'nesting-depth',
  reason: `命令嵌套 bash -c/eval 超过 ${MAX_SHELL_NESTING} 层，无法安全检查`
};

/** Scan the script a nested shell / eval would run; one layer past MAX_SHELL_NESTING is refused unseen. */
function scanNestedShell(source: string, depth: number, state: ScanState, env: ScanEnv): CommandHardlineMatch | null {
  const nesting = state.nesting + 1;
  if (nesting > MAX_SHELL_NESTING) return NESTING_DEPTH_HIT;
  return scanSource(source, depth, { ...env, nesting });
}

function matchCommand(command: ShellCommand, depth: number, state: ScanState): CommandHardlineMatch | null {
  for (const target of command.redirects) {
    const hit = classifyWriteTarget(target, 'redirect writing');
    if (hit) return hit;
  }
  const argv = command.words;
  const i = findHeadIndex(argv);
  const head = argv[i];
  if (!head) return null;
  const cmd = basename(head.text).toLowerCase();
  const args = argv.slice(i + 1);

  const aliasValue = head.literal ? undefined : state.aliases.get(head.text);
  if (aliasValue !== undefined && state.expansions.left > 0) {
    state.expansions.left -= 1;
    const source = [aliasValue, ...args.map(shellArg)].join(' ');
    const hit = scanSource(source, depth + 1, childEnv(state, argv.slice(0, i), true, head.text));
    if (hit) return hit;
  }
  const functionBody = state.functions.get(head.text);
  if (functionBody !== undefined && state.expansions.left > 0) {
    state.expansions.left -= 1;
    const params = { args: args.map(positionalText) };
    const hit = scanSource(functionBody, depth + 1, childEnv(state, argv.slice(0, i), true, undefined, params));
    if (hit) return hit;
  }

  if (SHELLS.has(cmd)) {
    const inline = shellInlineScript(args);
    if (inline !== null) {
      const [zero, ...positional] = inline.rest.map(positionalText);
      const params = { zero: zero ?? cmd, args: positional };
      return scanNestedShell(inline.script, depth, state, childEnv(state, argv.slice(0, i), false, undefined, params));
    }
    if (shellReadsStdin(args)) {
      const env = childEnv(state, argv.slice(0, i), false);
      for (const source of stdinSources(command)) {
        const hit = scanNestedShell(source, depth, state, env);
        if (hit) return hit;
      }
    }
  }
  if (cmd === 'eval' && args.length > 0) {
    return scanNestedShell(args.map((word) => word.text).join(' '), depth, state, childEnv(state, [], true));
  }
  if (cmd === 'rm') return matchRm(args, state.cwd);
  if (cmd === 'find') return matchFind(args, state.cwd);
  if (cmd === 'xargs') return matchXargs(command, args, depth, state);
  if (cmd === 'mkfs' || cmd === 'mke2fs' || cmd.startsWith('mkfs.')) {
    if (onlyInformationalFlags(args, MKFS_INFO_FLAGS)) return null;
    return { ruleId: 'mkfs', reason: `blocked ${cmd}` };
  }
  if (cmd === 'dd') return matchDd(args);
  if (cmd === 'tee') return matchWriteOperands(cmd, args, 'all');
  if (cmd === 'mv') return matchWriteOperands(cmd, args, 'last') ?? matchMoveSources(args, state.cwd);
  if (cmd === 'cp' || cmd === 'install' || cmd === 'rsync') {
    return matchWriteOperands(cmd, args, 'last');
  }
  if (cmd === 'chmod' || cmd === 'chown' || cmd === 'chgrp') return matchRecursivePerm(cmd, args, state.cwd);
  const interpreter = interpreterKind(cmd);
  if (interpreter) return matchInterpreter(interpreter, command, args, depth);
  if (cmd === 'wipefs') return matchWipefs(args);
  if (cmd === 'shred') return matchShred(args);
  if ((HARDLINE_POWER_COMMANDS as readonly string[]).includes(cmd)) {
    if (onlyInformationalFlags(args, POWER_INFO_FLAGS)) return null;
    return { ruleId: 'power', reason: `blocked ${cmd}` };
  }
  if (cmd === 'init' || cmd === 'telinit') return matchRunlevel(cmd, args);
  if (cmd === 'systemctl' || cmd === 'loginctl') return matchSystemctl(cmd, args);
  if (cmd === 'kill') return matchKill(args);
  if (cmd === 'killall5') return { ruleId: 'kill-minus-one', reason: 'blocked killall5' };
  return null;
}

const MKFS_INFO_FLAGS: ReadonlySet<string> = new Set(['--help', '--version', '-V']);
const POWER_INFO_FLAGS: ReadonlySet<string> = new Set(['--help', '--version']);

/** Read-only help / version query: every argument is an informational flag and nothing else. */
function onlyInformationalFlags(args: readonly ShellWord[], flags: ReadonlySet<string>): boolean {
  return args.length > 0 && args.every((word) => flags.has(word.text));
}

function shellReadsStdin(args: ShellWord[]): boolean {
  const operands = args.filter((word) => !word.text.startsWith('-') && !word.text.startsWith('+'));
  return operands.length === 0 || args.some((word) => word.text === '-s' || word.text === '-');
}

/** Script text that can reach a shell's stdin: heredocs, here-strings, and upstream pipe stages. */
function stdinSources(command: ShellCommand): string[] {
  const out: string[] = [...command.stdin];
  for (let up = command.upstream; up; up = up.upstream) {
    out.push(...up.stdin);
    const rest = up.words.slice(1).map((word) => word.text);
    out.push(...rest);
    if (rest.length > 1) out.push(rest.join(' '));
  }
  return out;
}

function matchRm(args: ShellWord[], cwd: string | null): CommandHardlineMatch | null {
  let recursive = false;
  const operands: ShellWord[] = [];
  let options = true;
  for (const word of args) {
    const text = word.text;
    if (options && text === '--') {
      options = false;
      continue;
    }
    if (options && text.startsWith('--')) {
      const name = text.includes('=') ? text.slice(0, text.indexOf('=')) : text;
      if (name === '--recursive') recursive = true;
      continue;
    }
    if (options && text.startsWith('-') && text !== '-') {
      if (/[rR]/.test(text.slice(1))) recursive = true;
      continue;
    }
    operands.push(word);
  }
  if (!recursive) return null;
  for (const operand of operands) {
    const hit = classifyRmTarget(operand, cwd);
    if (hit) return hit;
  }
  return null;
}

function classifyRmTarget(word: ShellWord, cwd: string | null = null): CommandHardlineMatch | null {
  if (!word.literal && isHomeWipe(word.text)) {
    return { ruleId: 'rm-home', reason: `recursive delete of home (${word.text})` };
  }
  const text = cwd !== null && isRelativeOperand(word.text) ? joinPath(cwd, word.text) : word.text;
  if (!text.startsWith('/')) return null;
  const dotParent = dotGlobParent(text);
  if (dotParent !== null) {
    const parent = normalizeAbsPath(dotParent === '' ? '/' : dotParent);
    if (parent === '/') return { ruleId: 'rm-root', reason: 'recursive delete of root dotfiles' };
    if (parent !== null && hostHomeDirs().has(parent)) {
      return { ruleId: 'rm-home', reason: `recursive delete of home dotfiles (${parent})` };
    }
  }
  const norm = normalizeAbsPath(text);
  if (!norm) return null;
  const glob = norm.endsWith('/*');
  const base = glob ? norm.slice(0, -2) || '/' : norm;
  if (base === '/') return { ruleId: 'rm-root', reason: 'recursive delete of /' };
  if ((HARDLINE_RM_SYSTEM_DIRS as readonly string[]).includes(base)) {
    return { ruleId: 'rm-system-dir', reason: `recursive delete of ${base}` };
  }
  if (hostHomeDirs().has(base)) {
    return { ruleId: 'rm-home', reason: `recursive delete of home (${base})` };
  }
  return null;
}

/** Exact dirs that admins routinely chown / chmod / move, so recursive-permission and mv rules skip them. */
const ADMIN_MANAGED_DIRS = new Set(['/opt', '/srv']);

/** `/`, `/*`, or an exact system directory. Globs of system dirs and home are deliberately not matched. */
function classifyExactTarget(word: ShellWord, cwd: string | null): string | null {
  let text = word.text;
  if (cwd !== null && isRelativeOperand(text)) text = joinPath(cwd, text);
  if (!text.startsWith('/')) return null;
  const norm = normalizeAbsPath(text);
  if (!norm) return null;
  const glob = norm.endsWith('/*');
  const base = glob ? norm.slice(0, -2) || '/' : norm;
  if (base === '/') return '/';
  if (!glob && !ADMIN_MANAGED_DIRS.has(base) && (HARDLINE_RM_SYSTEM_DIRS as readonly string[]).includes(base)) {
    return base;
  }
  return null;
}

const DOT_GLOBS = new Set(['.*', '.[!.]*', '.[^.]*', '.??*', '.[!.]?*', '.[^.]?*', '.[!.]??*']);

/** `*.*`, `.*`, `**`: a component made only of `*` and `.` that still matches every dotted name. */
const STAR_DOT_GLOB = /^[*.]*\*[*.]*$/;

/** Parent path when the last component is a dotfile / catch-all glob (`/home/u/.*`, `/*.*`), else null. */
function dotGlobParent(text: string): string | null {
  const slash = text.lastIndexOf('/');
  if (slash < 0) return null;
  const last = text.slice(slash + 1);
  if (!DOT_GLOBS.has(last) && !(last !== '*' && STAR_DOT_GLOB.test(last))) return null;
  return text.slice(0, slash);
}

function matchMoveSources(args: ShellWord[], cwd: string | null): CommandHardlineMatch | null {
  const operands: ShellWord[] = [];
  let hasTargetDir = false;
  let options = true;
  for (let i = 0; i < args.length; i += 1) {
    const word = args[i];
    if (!word) continue;
    const text = word.text;
    if (options && text === '--') {
      options = false;
      continue;
    }
    if (options && text.startsWith('--')) {
      if (text === '--target-directory') {
        hasTargetDir = true;
        i += 1;
      } else if (text.startsWith('--target-directory=')) {
        hasTargetDir = true;
      }
      continue;
    }
    if (options && text.startsWith('-') && text !== '-') {
      if (/^-[A-Za-z]*t$/.test(text)) {
        hasTargetDir = true;
        i += 1;
      }
      continue;
    }
    operands.push(word);
  }
  const sources = hasTargetDir ? operands : operands.slice(0, -1);
  for (const source of sources) {
    const base = classifyExactTarget(source, cwd);
    if (base !== null) return { ruleId: 'mv-system', reason: `mv of ${base}` };
    if (isHomeDirItself(source)) return { ruleId: 'mv-system', reason: 'mv of home' };
  }
  return null;
}

function matchRecursivePerm(cmd: string, args: ShellWord[], cwd: string | null): CommandHardlineMatch | null {
  let recursive = false;
  const operands: ShellWord[] = [];
  let options = true;
  for (const word of args) {
    const text = word.text;
    if (options && text === '--') {
      options = false;
      continue;
    }
    if (options && text.startsWith('--')) {
      if (text === '--recursive') recursive = true;
      continue;
    }
    if (options && text.startsWith('-') && text !== '-') {
      if (/^-[A-Za-z]*R[A-Za-z]*$/.test(text)) recursive = true;
      continue;
    }
    operands.push(word);
  }
  if (!recursive) return matchRootPerm(cmd, args, operands, cwd);
  const [spec, ...targets] = operands;
  const homeMode = cmd === 'chmod' && spec !== undefined && modeBreaksTree(spec.text);
  for (const operand of operands) {
    const base = classifyExactTarget(operand, cwd);
    if (base !== null) return { ruleId: 'recursive-perm', reason: `recursive ${cmd} of ${base}` };
  }
  if (homeMode && targets.some(isHomeDirItself)) {
    return { ruleId: 'recursive-perm', reason: `recursive chmod ${spec.text} of home` };
  }
  return null;
}

/** The home directory itself (`~`, `$HOME`, its absolute path), not its children or a glob of them. */
function isHomeDirItself(word: ShellWord): boolean {
  if (!word.literal && /^(?:~|\$HOME|\$\{HOME\})\/*$/.test(word.text)) return true;
  if (word.dynamic || word.text.endsWith('*') || !word.text.startsWith('/')) return false;
  const norm = normalizeAbsPath(word.text);
  return norm !== null && hostHomeDirs().has(norm);
}

/** chmod mode that makes a tree world-writable or locks its owner out. Unparseable counts as safe. */
function modeBreaksTree(mode: string): boolean {
  if (/^[0-7]{1,4}$/.test(mode)) {
    const bits = Number.parseInt(mode, 8);
    return (bits & 0o002) !== 0 || (bits & 0o700) !== 0o700;
  }
  for (const clause of mode.split(',')) {
    const parsed = /^([ugoa]*)([-+=])([rwxXst]*)$/.exec(clause);
    if (!parsed) return false;
    const [, who = '', op, perms = ''] = parsed;
    const world = who === '' || /[oa]/.test(who);
    if ((op === '+' || op === '=') && world && perms.includes('w')) return true;
    if (op === '-' && /[ua]/.test(who) && /[rwx]/.test(perms)) return true;
  }
  return false;
}

function isRootItself(word: ShellWord, cwd: string | null): boolean {
  const text = cwd !== null && isRelativeOperand(word.text) ? joinPath(cwd, word.text) : word.text;
  return text.startsWith('/') && normalizeAbsPath(text) === '/';
}

const ROOT_OWNER = /^(?:root|0)?(?::(?:root|0)?)?$/;

/** Mode that leaves `/` traversable by everyone. Anything unparseable counts as safe (unknown). */
function modeKeepsRootUsable(mode: string): boolean {
  if (/^[0-7]{1,4}$/.test(mode)) return (Number.parseInt(mode, 8) & 0o755) === 0o755;
  for (const clause of mode.split(',')) {
    const parsed = /^[ugoa]*([-+=])([rwxXst]*)$/.exec(clause);
    if (!parsed) return true;
    const [, op, perms = ''] = parsed;
    if (op === '-' && /[rxX]/.test(perms)) return false;
    if (op === '=' && !(perms.includes('r') && /[xX]/.test(perms))) return false;
  }
  return true;
}

/**
 * Non-recursive chmod / chown / chgrp of `/` itself. Locking the root directory or handing it to a
 * non-root owner breaks every login and service, so it is refused; restoring sane values is not.
 * Exact system subdirectories and `/*` are not matched here.
 */
function matchRootPerm(
  cmd: string,
  args: ShellWord[],
  operands: ShellWord[],
  cwd: string | null
): CommandHardlineMatch | null {
  if (args.some((word) => word.text.startsWith('--reference'))) return null;
  const [spec, ...targets] = operands;
  if (!spec || spec.dynamic || spec.text.includes('$') || !targets.some((word) => isRootItself(word, cwd))) {
    return null;
  }
  const harmless = cmd === 'chmod' ? modeKeepsRootUsable(spec.text) : ROOT_OWNER.test(spec.text);
  return harmless ? null : { ruleId: 'root-perm', reason: `${cmd} ${spec.text} on /` };
}

const XARGS_VALUE_OPTIONS = new Set([
  '-a',
  '-d',
  '-E',
  '-I',
  '-L',
  '-n',
  '-P',
  '-s',
  '--arg-file',
  '--delimiter',
  '--max-args',
  '--max-procs',
  '--max-chars',
  '--max-lines',
  '--process-slot-var'
]);

function matchXargs(
  command: ShellCommand,
  args: ShellWord[],
  depth: number,
  state: ScanState
): CommandHardlineMatch | null {
  let fromFile = false;
  let i = 0;
  for (; i < args.length; i += 1) {
    const text = args[i]?.text ?? '';
    if (text === '--') {
      i += 1;
      break;
    }
    if (!text.startsWith('-') || text === '-') break;
    if (text === '-a' || text === '--arg-file' || text.startsWith('--arg-file=')) fromFile = true;
    if (XARGS_VALUE_OPTIONS.has(text)) i += 1;
  }
  const inner = args.slice(i);
  if (inner.length === 0) return null;
  const direct = matchCommand({ ...command, words: inner, redirects: [], stdin: [], upstream: null }, depth, state);
  if (direct) return direct;
  if (fromFile || command.stdin.length > 0 || commandHeadOf(inner)?.cmd !== 'rm') return null;
  const source = xargsListingHit(command.upstream, state.cwd);
  if (!source) return null;
  return { ruleId: source.ruleId, reason: `xargs rm fed by unfiltered listing: ${source.reason}` };
}

const PASSTHROUGH_FILTERS = new Set(['cat', 'sort', 'tac', 'uniq', 'tee']);

/** The listing that feeds xargs when it is an unfiltered find/ls of root, a system dir, or home. */
function xargsListingHit(upstream: ShellCommand | null, cwd: string | null): CommandHardlineMatch | null {
  let stage = upstream;
  for (let hops = 0; stage && hops < 4; hops += 1) {
    const head = commandHeadOf(stage.words);
    if (!head) return null;
    if (PASSTHROUGH_FILTERS.has(head.cmd)) {
      if (head.cmd !== 'tee' && nonOptionOperands(head.args).length > 0) return null;
      stage = stage.upstream;
      continue;
    }
    if (head.cmd === 'find') return findListingHit(head.args, cwd);
    if (head.cmd === 'ls') return lsListingHit(head.args, cwd);
    return null;
  }
  return null;
}

function findListingHit(args: ShellWord[], cwd: string | null): CommandHardlineMatch | null {
  const { roots, rest } = parseFind(args);
  if (findIsNarrowed(rest)) return null;
  const targets = roots.length > 0 ? roots : [{ text: '.', literal: false }];
  for (const root of targets) {
    const hit = classifyRmTarget(root, cwd);
    if (hit) return hit;
  }
  return null;
}

function lsListingHit(args: ShellWord[], cwd: string | null): CommandHardlineMatch | null {
  if (args.some((word) => word.text === '-I' || word.text.startsWith('--ignore') || word.text.startsWith('--hide'))) {
    return null;
  }
  const operands = nonOptionOperands(args);
  const targets = operands.length > 0 ? operands : ['.'];
  for (const target of targets) {
    const hit = classifyRmTarget({ text: target, literal: false }, cwd);
    if (hit) return hit;
  }
  return null;
}

function hostHomeDirs(): Set<string> {
  const out = new Set<string>();
  for (const raw of [process.env.HOME, safeHomedir()]) {
    if (!raw) continue;
    const norm = normalizeAbsPath(raw);
    if (norm && norm !== '/') out.add(norm);
  }
  return out;
}

function safeHomedir(): string | undefined {
  try {
    return homedir();
  } catch {
    return undefined;
  }
}

/** Predicates that do not narrow which files `find` visits. Any other test is treated as a filter. */
const FIND_NEUTRAL_PREDICATES = new Set([
  '-delete',
  '-depth',
  '-xdev',
  '-mount',
  '-maxdepth',
  '-mindepth',
  '-print',
  '-print0',
  '-exec',
  '-execdir',
  '-ok',
  '-okdir'
]);

function findIsNarrowed(expr: ShellWord[]): boolean {
  for (let i = 0; i < expr.length; i += 1) {
    const text = expr[i]?.text ?? '';
    if (['-exec', '-execdir', '-ok', '-okdir'].includes(text)) {
      while (i < expr.length && expr[i]?.text !== ';' && expr[i]?.text !== '+') i += 1;
      continue;
    }
    if (text.startsWith('-') && !FIND_NEUTRAL_PREDICATES.has(text)) return true;
  }
  return false;
}

function parseFind(args: ShellWord[]): { roots: ShellWord[]; rest: ShellWord[] } {
  const roots: ShellWord[] = [];
  let i = 0;
  while (i < args.length) {
    const text = args[i]?.text ?? '';
    if (text === '-H' || text === '-L' || text === '-P' || /^-O\d$/.test(text) || text === '-D') {
      i += text === '-D' ? 2 : 1;
      continue;
    }
    break;
  }
  for (; i < args.length; i += 1) {
    const word = args[i];
    if (!word) break;
    if (word.text.startsWith('-') || word.text === '(' || word.text === '!') break;
    roots.push(word);
  }
  return { roots, rest: args.slice(i) };
}

/** Unfiltered `find <root|system|home> ... -delete` or `-exec rm -r`, which is `rm -rf` by another name. */
function matchFind(args: ShellWord[], cwd: string | null): CommandHardlineMatch | null {
  const { roots, rest } = parseFind(args);
  const deletes = rest.some((word) => word.text === '-delete');
  const execRm = rest.some((word, idx) => {
    if (!['-exec', '-execdir', '-ok', '-okdir'].includes(word.text)) return false;
    const target = rest[idx + 1]?.text;
    return target !== undefined && basename(target).toLowerCase() === 'rm';
  });
  if (!deletes && !execRm) return null;
  if (findIsNarrowed(rest)) return null;
  const targets = roots.length > 0 ? roots : [{ text: '.', literal: false }];
  for (const root of targets) {
    const hit = classifyRmTarget(root, cwd);
    if (hit) return hit;
  }
  return null;
}

function matchDd(args: ShellWord[]): CommandHardlineMatch | null {
  for (const word of args) {
    if (!word.text.startsWith('of=')) continue;
    const dest = word.text.slice(3);
    if (isRawBlockDevice(dest)) {
      return { ruleId: 'dd-raw-device', reason: `dd writing raw device ${dest}` };
    }
    if (isSensitiveProcPath(dest)) {
      return { ruleId: 'proc-write', reason: `dd writing ${dest}` };
    }
  }
  return null;
}

/** Only the sysrq trigger and `/proc/sys/kernel/*` are refused; other /proc writes (drop_caches...) pass. */
function isSensitiveProcPath(path: string): boolean {
  if (!path.startsWith('/proc/')) return false;
  const norm = normalizeAbsPath(path);
  return norm !== null && (norm === '/proc/sysrq-trigger' || norm.startsWith('/proc/sys/kernel/'));
}

/** Refusal for a file that is about to be written, or null. `verb` prefixes the reason. */
function classifyWriteTarget(path: string, verb: string): CommandHardlineMatch | null {
  if (isRawBlockDevice(path)) {
    return { ruleId: 'raw-device-write', reason: `${verb} raw device ${path}` };
  }
  if (isSensitiveProcPath(path)) {
    return { ruleId: 'proc-write', reason: `${verb} ${path}` };
  }
  return null;
}

/** `/dev/null`, `/dev/stderr`, `/dev/tty`, `/dev/zero`... are not block devices and pass. */
function isRawBlockDevice(path: string): boolean {
  if (!path.startsWith('/')) return false;
  if (BLOCK_DEVICE.test(path)) return true;
  const norm = normalizeAbsPath(path);
  return norm !== null && BLOCK_DEVICE.test(norm);
}

function nonOptionOperands(args: ShellWord[]): string[] {
  const out: string[] = [];
  let options = true;
  for (const word of args) {
    if (options && word.text === '--') {
      options = false;
      continue;
    }
    if (options && word.text.startsWith('-') && word.text !== '-') continue;
    out.push(word.text);
  }
  return out;
}

/** tee writes every operand; cp/mv/install/rsync write their last operand. */
function matchWriteOperands(
  cmd: string,
  args: ShellWord[],
  which: 'all' | 'last'
): CommandHardlineMatch | null {
  const operands = nonOptionOperands(args);
  const targets = which === 'all' ? operands : operands.slice(-1);
  for (const target of targets) {
    const hit = classifyWriteTarget(target, `${cmd} writing`);
    if (hit) return hit;
  }
  return null;
}

/** Listing (`wipefs /dev/sda`) and dry runs (`-n`) do not erase anything. */
function matchWipefs(args: ShellWord[]): CommandHardlineMatch | null {
  let destructive = false;
  let dryRun = false;
  for (const word of args) {
    const text = word.text;
    if (text === '--all' || text === '--force' || text === '--offset') destructive = true;
    else if (text === '--no-act') dryRun = true;
    else if (/^-[A-Za-z]+$/.test(text)) {
      if (/[afo]/.test(text)) destructive = true;
      if (text.includes('n')) dryRun = true;
    }
  }
  if (!destructive || dryRun) return null;
  const device = nonOptionOperands(args).find((operand) => isRawBlockDevice(operand));
  return device ? { ruleId: 'wipe-device', reason: `wipefs erasing ${device}` } : null;
}

function matchShred(args: ShellWord[]): CommandHardlineMatch | null {
  const device = nonOptionOperands(args).find((operand) => isRawBlockDevice(operand));
  return device ? { ruleId: 'wipe-device', reason: `shred overwriting ${device}` } : null;
}

type InterpreterKind = 'python' | 'node' | 'perl' | 'ruby' | 'php';

function interpreterKind(cmd: string): InterpreterKind | null {
  if (/^python\d*(?:\.\d+)*$/.test(cmd) || /^pypy\d*$/.test(cmd)) return 'python';
  if (cmd === 'node' || cmd === 'nodejs') return 'node';
  if (cmd === 'perl' || cmd === 'ruby' || cmd === 'php') return cmd;
  return null;
}

const INLINE_FLAG: Record<InterpreterKind, RegExp> = {
  python: /^-[A-Za-z]*c$/,
  node: /^(?:-e|-p|-pe|-ep|--eval|--print)$/,
  perl: /^-[A-Za-z]*[eE]$/,
  ruby: /^-[A-Za-z]*e$/,
  php: /^-r$/
};

const INTERPRETER_VALUE_FLAGS: Record<InterpreterKind, ReadonlySet<string>> = {
  python: new Set(['-W', '-X', '-Q']),
  node: new Set(['-r', '--require', '--import', '--loader', '--input-type']),
  perl: new Set(['-I']),
  ruby: new Set(['-I', '-r']),
  php: new Set(['-d', '-c'])
};

/**
 * One-liner interpreters: only a literal delete of root / a system dir, or a literal shell command
 * handed to system()/exec()/subprocess, is refused. Everything else in the script text is allowed.
 */
function matchInterpreter(
  kind: InterpreterKind,
  command: ShellCommand,
  args: ShellWord[],
  depth: number
): CommandHardlineMatch | null {
  const scripts: string[] = [];
  let sawOperand = false;
  let sawDash = false;
  for (let i = 0; i < args.length; i += 1) {
    const text = args[i]?.text ?? '';
    if (text === '-') {
      sawDash = true;
      continue;
    }
    if (text === '--' || !text.startsWith('-') || (kind === 'python' && text === '-m')) {
      sawOperand = true;
      break;
    }
    if (INLINE_FLAG[kind].test(text)) {
      const script = args[i + 1]?.text;
      if (script !== undefined) scripts.push(script);
      i += 1;
      continue;
    }
    if (kind === 'node' && (text.startsWith('--eval=') || text.startsWith('--print='))) {
      scripts.push(text.slice(text.indexOf('=') + 1));
      continue;
    }
    if (INTERPRETER_VALUE_FLAGS[kind].has(text)) i += 1;
  }
  if (scripts.length === 0 && (sawDash || !sawOperand)) scripts.push(...command.stdin);
  for (const script of scripts) {
    const hit = scanInterpreterScript(script, depth);
    if (hit) return hit;
  }
  return null;
}

const DIRECT_DELETE_CALL =
  /(?:\b(?:rmtree|remove_tree|rmSync|rmdirSync|rimraf|rimrafSync|removeSync|emptyDirSync|rm_rf|rm_r|remove_entry|remove_entry_secure|remove_dir)(?:\.sync)?|(?:\bfs\w*|\))\.(?:promises\.)?(?:rm|rmdir|remove|emptyDir))\s*\(\s*/g;

const SHELL_EXEC_CALL =
  /\b(?:system|popen|exec|execSync|execFile|execFileSync|spawn|spawnSync|run|call|Popen|check_call|check_output|getoutput|getstatusoutput|execv|execvp|execl|execlp|shell_exec|passthru|proc_open)\s*\(\s*/g;

/** Start offsets of every string literal, so a call that is only mentioned inside `print("...")` is not a call. */
function stringLiteralRanges(script: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = 0;
  while (i < script.length) {
    const ch = script[i];
    if (ch !== "'" && ch !== '"' && ch !== '`') {
      i += 1;
      continue;
    }
    const literal = readStringLiteral(script, i);
    if (!literal) {
      i += 1;
      continue;
    }
    ranges.push([i, literal.end]);
    i = literal.end;
  }
  return ranges;
}

function scanInterpreterScript(script: string, depth: number): CommandHardlineMatch | null {
  if (depth > MAX_SCAN_DEPTH) return null;
  const literals = stringLiteralRanges(script);
  const insideString = (index: number) => literals.some(([start, end]) => index > start && index < end);
  for (const call of script.matchAll(DIRECT_DELETE_CALL)) {
    if (insideString(call.index ?? 0)) continue;
    const literal = readStringLiteral(script, (call.index ?? 0) + call[0].length);
    if (!literal || /[*?]/.test(literal.value)) continue;
    const hit = classifyRmTarget({ text: literal.value, literal: true });
    if (hit) return { ruleId: hit.ruleId, reason: `interpreter one-liner deleting ${literal.value}` };
  }
  for (const call of script.matchAll(SHELL_EXEC_CALL)) {
    if (insideString(call.index ?? 0)) continue;
    const args = readLiteralCallArgs(script, (call.index ?? 0) + call[0].length);
    if (!args) continue;
    const sources = [args.parts[0] ?? '', args.parts.map(shellQuote).join(' ')];
    for (const source of sources) {
      const hit = scanSource(source, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** Re-emit a lexed word so that re-lexing gives the same word back. */
function shellArg(word: ShellWord): string {
  if (!word.literal && word.text !== '' && /^[A-Za-z0-9_@%+=:,./~$-]+$/.test(word.text)) return word.text;
  return shellQuote(word.text);
}

function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function readStringLiteral(source: string, start: number): { value: string; end: number } | null {
  let pos = start;
  while (pos - start < 2 && /[rRbBuUfF]/.test(source[pos] ?? '')) pos += 1;
  const quote = source[pos];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;
  let value = '';
  for (let i = pos + 1; i < source.length; i += 1) {
    const ch = source[i] ?? '';
    if (ch === '\\' && i + 1 < source.length) {
      const next = source[i + 1] ?? '';
      value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
      i += 1;
      continue;
    }
    if (ch === quote) return quote === '`' && value.includes('${') ? null : { value, end: i + 1 };
    value += ch;
  }
  return null;
}

function skipBlanks(source: string, start: number): number {
  let pos = start;
  while (/\s/.test(source[pos] ?? '')) pos += 1;
  return pos;
}

/** Leading run of string literals and string-array literals in a call's argument list. */
function readLiteralCallArgs(source: string, start: number): { parts: string[] } | null {
  const parts: string[] = [];
  let pos = start;
  for (;;) {
    pos = skipBlanks(source, pos);
    const open = source[pos];
    if (open === '[' || open === '(') {
      const close = open === '[' ? ']' : ')';
      pos += 1;
      for (;;) {
        pos = skipBlanks(source, pos);
        if (source[pos] === close) {
          pos += 1;
          break;
        }
        const element = readStringLiteral(source, pos);
        if (!element) return null;
        parts.push(element.value);
        pos = skipBlanks(source, element.end);
        if (source[pos] === ',') pos += 1;
        else if (source[pos] === close) {
          pos += 1;
          break;
        } else return null;
      }
    } else {
      const literal = readStringLiteral(source, pos);
      if (!literal) break;
      parts.push(literal.value);
      pos = literal.end;
    }
    pos = skipBlanks(source, pos);
    if (source[pos] !== ',') break;
    pos += 1;
  }
  return parts.length > 0 ? { parts } : null;
}

function matchRunlevel(cmd: string, args: ShellWord[]): CommandHardlineMatch | null {
  const op = firstOperand(args);
  if (op === '0' || op === '6') {
    return { ruleId: 'init-runlevel', reason: `blocked ${cmd} ${op}` };
  }
  return null;
}

const POWER_VERBS = new Set(['poweroff', 'reboot', 'halt', 'kexec']);
const POWER_TARGET = /^(?:poweroff|reboot|halt|kexec|shutdown)(?:\.target)?$/;

function matchSystemctl(cmd: string, args: ShellWord[]): CommandHardlineMatch | null {
  const verbs = systemctlOperands(args);
  const sub = verbs[0];
  if (sub === undefined) return null;
  if (POWER_VERBS.has(sub)) {
    return { ruleId: 'systemctl-power', reason: `blocked ${cmd} ${sub}` };
  }
  if (cmd === 'systemctl' && (sub === 'isolate' || sub === 'start')) {
    const target = verbs.slice(1).find((unit) => POWER_TARGET.test(unit));
    if (target) return { ruleId: 'systemctl-power', reason: `blocked ${cmd} ${sub} ${target}` };
  }
  return null;
}

function matchKill(args: ShellWord[]): CommandHardlineMatch | null {
  const hit = { ruleId: 'kill-minus-one' as const, reason: 'blocked kill of every process (pid -1)' };
  let sawSignal = false;
  let operands = 0;
  let options = true;
  for (let i = 0; i < args.length; i += 1) {
    const text = args[i]?.text ?? '';
    if (options && text === '--') {
      options = false;
      continue;
    }
    if (options && /^-(?:l|L|t)$/.test(text)) return null;
    if (options && text.startsWith('--')) {
      if (text === '--list' || text === '--table') return null;
      if (text === '--signal' || text === '--queue') i += 1;
      sawSignal = true;
      continue;
    }
    if (options && (text === '-s' || text === '-n' || text === '-q')) {
      sawSignal = true;
      i += 1;
      continue;
    }
    if (options && text.startsWith('-') && text.length > 1 && !sawSignal) {
      sawSignal = true;
      continue;
    }
    operands += 1;
    if (text === '-1') return hit;
  }
  if (operands === 0 && args.length === 1 && args[0]?.text === '-1') return hit;
  return null;
}

function firstOperand(args: ShellWord[]): string | undefined {
  let options = true;
  for (const word of args) {
    if (options && word.text === '--') {
      options = false;
      continue;
    }
    if (options && word.text.startsWith('-')) continue;
    return word.text;
  }
  return undefined;
}

function systemctlOperands(args: ShellWord[]): string[] {
  const takesValue = new Set([
    '-t',
    '--type',
    '-p',
    '--property',
    '-H',
    '--host',
    '-M',
    '--machine',
    '--state'
  ]);
  const out: string[] = [];
  let options = true;
  for (let i = 0; i < args.length; i += 1) {
    const text = args[i]?.text;
    if (!text) continue;
    if (options && text === '--') {
      options = false;
      continue;
    }
    if (options && text.startsWith('-')) {
      if (takesValue.has(text)) i += 1;
      continue;
    }
    out.push(text);
  }
  return out;
}

/** The `-c` script plus the operands after it (`$0`, `$1`, ...). */
function shellInlineScript(args: ShellWord[]): { script: string; rest: ShellWord[] } | null {
  const at = (i: number) => ({ script: args[i + 1]?.text ?? '', rest: args.slice(i + 2) });
  for (let i = 0; i < args.length; i += 1) {
    const text = args[i]?.text;
    if (!text) return null;
    if (text === '--') return null;
    if (text === '-c' || text === '--command') return at(i);
    if (text === '-o' || text === '+o' || text === '-O' || text === '+O') {
      i += 1;
      continue;
    }
    if (text.startsWith('--') || text.startsWith('+')) continue;
    if (text.startsWith('-')) {
      if (text.includes('c')) return at(i);
      continue;
    }
    return null;
  }
  return null;
}

const TIME_VALUE_FLAGS = new Set(['-f', '--format', '-o', '--output']);

function skipWrappers(argv: ShellWord[], start: number): number {
  const textAt = (index: number): string | undefined => argv[index]?.text;
  let i = start;
  while (i < argv.length) {
    const current = textAt(i);
    if (current === undefined) break;
    if (isAssignment(current)) {
      i += 1;
      continue;
    }
    const cmd = basename(current);
    if (cmd === 'sudo') {
      i += 1;
      while (i < argv.length) {
        const flag = textAt(i);
        if (!flag?.startsWith('-')) break;
        if (flag === '--') {
          i += 1;
          break;
        }
        if (
          flag === '-u' ||
          flag === '--user' ||
          flag === '-g' ||
          flag === '--group' ||
          flag === '-h' ||
          flag === '--host' ||
          flag === '-p' ||
          flag === '--prompt' ||
          flag === '-C' ||
          flag === '--close-from' ||
          flag === '-T' ||
          flag === '--command-timeout' ||
          flag === '-r' ||
          flag === '--role' ||
          flag === '-t' ||
          flag === '--type'
        ) {
          i += 2;
          continue;
        }
        i += 1;
      }
      continue;
    }
    if (cmd === 'command') {
      i += 1;
      while (textAt(i)?.startsWith('-')) i += 1;
      continue;
    }
    if (cmd === 'env') {
      i += 1;
      while (i < argv.length) {
        const flag = textAt(i);
        if (flag === undefined) break;
        if (!(flag.startsWith('-') || isAssignment(flag))) break;
        if (flag === '-u' || flag === '--unset' || flag === '-C' || flag === '--chdir') {
          i += 2;
          continue;
        }
        i += 1;
      }
      continue;
    }
    if (cmd === 'exec') {
      i += 1;
      continue;
    }
    if (cmd === 'nohup' || cmd === 'time') {
      i += 1;
      while (textAt(i)?.startsWith('-')) i += cmd === 'time' && TIME_VALUE_FLAGS.has(textAt(i)!) ? 2 : 1;
      continue;
    }
    if (cmd === 'nice') {
      i += 1;
      while (i < argv.length) {
        const flag = textAt(i);
        if (!flag?.startsWith('-')) break;
        if (flag === '-n' || flag === '--adjustment') i += 1;
        i += 1;
      }
      continue;
    }
    if (cmd === 'stdbuf') {
      i += 1;
      while (i < argv.length) {
        const flag = textAt(i);
        if (!flag?.startsWith('-')) break;
        if (/^-[ioe]$/.test(flag)) i += 1;
        i += 1;
      }
      continue;
    }
    if (cmd === 'busybox' || cmd === 'setsid' || cmd === 'builtin') {
      i += 1;
      while (cmd === 'setsid' && textAt(i)?.startsWith('-')) i += 1;
      continue;
    }
    if (cmd === 'doas') {
      i += 1;
      while (i < argv.length) {
        const flag = textAt(i);
        if (!flag?.startsWith('-')) break;
        if (flag === '-u' || flag === '-C') i += 1;
        i += 1;
      }
      continue;
    }
    if (cmd === 'ionice') {
      i += 1;
      while (i < argv.length) {
        const flag = textAt(i);
        if (!flag?.startsWith('-')) break;
        if (/^-[cnpPu]$/.test(flag)) i += 1;
        i += 1;
      }
      continue;
    }
    if (cmd === 'timeout') {
      i += 1;
      while (i < argv.length) {
        const flag = textAt(i);
        if (!flag?.startsWith('-')) break;
        if (flag === '-s' || flag === '-k' || flag === '--signal' || flag === '--kill-after') i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    break;
  }
  return i;
}

function isAssignment(text: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(text);
}

function basename(command: string): string {
  const slash = command.lastIndexOf('/');
  return slash >= 0 ? command.slice(slash + 1) : command;
}

function isHomeWipe(token: string): boolean {
  const rest = homeRemainder(token);
  if (rest === null) return false;
  let path = rest;
  if (path.endsWith('/*')) path = path.slice(0, -2);
  const stack: string[] = [];
  const parts = path.split('/');
  if (DOT_GLOBS.has(parts[parts.length - 1] ?? '')) parts.pop();
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (stack.length === 0) return true;
      stack.pop();
      continue;
    }
    if (part.includes('*') || part.includes('?') || part.includes('[')) return false;
    stack.push(part);
  }
  return stack.length === 0;
}

function homeRemainder(token: string): string | null {
  if (token === '~') return '';
  if (token.startsWith('~/')) return token.slice(1);
  const otherUser = /^~[A-Za-z_][\w.-]*(\/.*)?$/.exec(token);
  if (otherUser) return otherUser[1] ?? '';
  if (token === '$HOME') return '';
  if (token.startsWith('$HOME/')) return token.slice('$HOME'.length);
  if (token === '${HOME}') return '';
  if (token.startsWith('${HOME}/')) return token.slice('${HOME}'.length);
  return null;
}

/** Lexical normalize. Trailing `/*` marks a wipe of that directory. `null` = not an exact path. */
function normalizeAbsPath(input: string): string | null {
  let path = input;
  let globChildren = false;
  if (path.endsWith('/*')) {
    globChildren = true;
    path = path.slice(0, -2);
    if (path.length === 0) path = '/';
  }
  if (!path.startsWith('/')) return null;
  const stack: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    if (part.includes('*') || part.includes('?') || part.includes('[')) return null;
    stack.push(part);
  }
  const norm = stack.length === 0 ? '/' : `/${stack.join('/')}`;
  return globChildren ? `${norm}/*` : norm;
}

function unquotedText(source: string): string {
  let out = '';
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i] ?? '';
    if (quote === "'") {
      if (ch === "'") quote = null;
      else out += ' ';
      continue;
    }
    if (quote === '"') {
      if (ch === '\\' && i + 1 < source.length) {
        out += ' ';
        i += 1;
        continue;
      }
      if (ch === '"') quote = null;
      else out += ' ';
      continue;
    }
    if (ch === '\\' && i + 1 < source.length) {
      out += source[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (ch === "'") {
      quote = "'";
      continue;
    }
    if (ch === '"') {
      quote = '"';
      continue;
    }
    if (ch === '#' && (out.length === 0 || /[\s;&|(){}]/.test(out[out.length - 1] ?? ''))) {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      if (source[i] === '\n') out += '\n';
      continue;
    }
    out += ch;
  }
  return out;
}

interface PendingHeredoc {
  target: ShellCommand;
  delim: string;
  stripTabs: boolean;
}

function newShellCommand(): ShellCommand {
  return {
    words: [],
    stdin: [],
    upstream: null,
    redirects: [],
    depth: 0,
    pipeOut: false,
    async: false,
    afterOr: false
  };
}

function lexShell(source: string): LexResult {
  const commands: ShellCommand[] = [];
  const subs: string[] = [];
  let current = newShellCommand();
  let pipePrev: ShellCommand | null = null;
  const pendingHeredocs: PendingHeredoc[] = [];
  let text = '';
  let literal = true;
  let dynamic = false;
  let has = false;
  let quote: "'" | '"' | null = null;
  let groupDepth = 0;
  let pendingOr = false;

  const resetWord = () => {
    text = '';
    literal = true;
    dynamic = false;
    has = false;
  };

  const flushWord = () => {
    if (!has) {
      resetWord();
      return;
    }
    current.words.push(dynamic ? { text, literal, dynamic } : { text, literal });
    resetWord();
  };

  const flushCommand = (kind: 'pipe' | 'sep' | 'newline' | 'or' | 'bg') => {
    flushWord();
    if (current.words.length > 0 || current.redirects.length > 0) {
      current.upstream = pipePrev;
      current.depth = groupDepth;
      current.pipeOut = kind === 'pipe';
      current.async = kind === 'bg';
      current.afterOr = pendingOr;
      commands.push(current);
      pipePrev = kind === 'pipe' ? current : null;
      pendingOr = kind === 'or';
      current = newShellCommand();
    } else if (kind !== 'pipe' && kind !== 'newline') {
      pipePrev = null;
      if (kind === 'or') pendingOr = true;
    }
  };

  const pushChunk = (chunk: string, fromSingle: boolean) => {
    if (chunk.length === 0) return;
    text += chunk;
    has = true;
    if (!fromSingle) literal = false;
  };

  const recordDefinition = (name: string, body: string) => {
    resetWord();
    current = newShellCommand();
    commands.push({ ...newShellCommand(), def: { name, body }, depth: groupDepth, afterOr: pendingOr });
    pendingOr = false;
    pipePrev = null;
  };

  /** Every substitution is scanned as code; a literal echo / printf result is also spliced into the word. */
  const substitute = (body: string, quoted: boolean) => {
    subs.push(body);
    const value = literalSubstitutionValue(body);
    if (value === null) {
      dynamic = true;
      pushChunk(UNKNOWN_SUBSTITUTION, false);
      return;
    }
    if (quoted || /^[A-Za-z_][A-Za-z0-9_]*=/.test(text)) {
      pushChunk(value, false);
      return;
    }
    value.split(/\s+/).forEach((part, k) => {
      if (k > 0) flushWord();
      pushChunk(part, false);
    });
  };

  let i = 0;
  while (i < source.length) {
    const ch = source[i] ?? '';
    if (quote === "'") {
      if (ch === "'") {
        quote = null;
        has = true;
      } else {
        pushChunk(ch, true);
      }
      i += 1;
      continue;
    }
    if (quote === '"') {
      if (ch === '\\' && i + 1 < source.length) {
        const next = source[i + 1] ?? '';
        if (next === '"' || next === '\\' || next === '$' || next === '`' || next === '\n') {
          if (next !== '\n') pushChunk(next, false);
          i += 2;
          continue;
        }
      }
      if (ch === '"') {
        quote = null;
        has = true;
        i += 1;
        continue;
      }
      if (ch === '`') {
        const end = findBacktick(source, i + 1);
        substitute(source.slice(i + 1, end), true);
        i = end + 1;
        continue;
      }
      if (ch === '$' && source[i + 1] === '(') {
        i = consumeDollarParen(source, i, subs, pushChunk, (body) => substitute(body, true));
        continue;
      }
      pushChunk(ch, false);
      i += 1;
      continue;
    }

    if (ch === '\\') {
      if (i + 1 < source.length) {
        const next = source[i + 1] ?? '';
        if (next !== '\n') pushChunk(next, false);
        i += 2;
        continue;
      }
    }
    if (ch === "'") {
      quote = "'";
      i += 1;
      continue;
    }
    if (ch === '"') {
      quote = '"';
      i += 1;
      continue;
    }
    if (ch === '`') {
      const end = findBacktick(source, i + 1);
      substitute(source.slice(i + 1, end), false);
      i = end + 1;
      continue;
    }
    if (ch === '$' && source[i + 1] === '(') {
      i = consumeDollarParen(source, i, subs, pushChunk, (body) => substitute(body, false));
      continue;
    }
    if (ch === '$' && source[i + 1] === '{') {
      const end = findMatchingBrace(source, i + 1);
      pushChunk(source.slice(i, end + 1), false);
      i = end + 1;
      continue;
    }
    if ((ch === '<' || ch === '>') && source[i + 1] === '(') {
      const end = findMatchingParen(source, i + 1);
      subs.push(source.slice(i + 2, end));
      dynamic = true;
      pushChunk(UNKNOWN_SUBSTITUTION, false);
      i = end + 1;
      continue;
    }
    if (ch === '<' && source[i + 1] === '<' && source[i + 2] === '<') {
      flushWord();
      const end = skipHereString(source, i + 3);
      current.stdin.push(unquoteWord(source.slice(i + 3, end).trim()));
      i = end;
      continue;
    }
    if (ch === '<' && source[i + 1] === '<') {
      flushWord();
      const start = parseHeredocStart(source, i);
      pendingHeredocs.push({ target: current, delim: start.delim, stripTabs: start.stripTabs });
      i = start.next;
      continue;
    }
    if (ch === '<' || ch === '>') {
      if (/^\d+$/.test(text)) resetWord();
      else flushWord();
      const end = skipRedirect(source, i + 1);
      if (ch === '>') {
        const target = redirectTarget(source.slice(i + 1, end));
        if (target) current.redirects.push(target);
      }
      i = end;
      continue;
    }
    if (ch === '#' && !has) {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      flushWord();
      i += 1;
      continue;
    }
    if (ch === '\n') {
      flushCommand('newline');
      i += 1;
      for (const pending of pendingHeredocs) {
        const body = readHeredocBody(source, i, pending.delim, pending.stripTabs);
        pending.target.stdin.push(body.text);
        i = body.next;
      }
      pendingHeredocs.length = 0;
      continue;
    }
    if (ch === '(') {
      const def = functionDefinitionAt(source, i, current.words, has ? text : null);
      if (def) {
        recordDefinition(def.name, def.body);
        i = def.next;
        continue;
      }
      flushCommand('sep');
      groupDepth += 1;
      i += 1;
      continue;
    }
    if (ch === '{' && !has && isGroupBrace(source, i) && isFunctionKeyword(current.words)) {
      const end = findMatchingBrace(source, i);
      const closed = source[end] === '}';
      recordDefinition(current.words[1]?.text ?? '', source.slice(i + 1, closed ? end : source.length));
      i = closed ? end + 1 : source.length;
      continue;
    }
    if (ch === ')') {
      flushCommand('sep');
      groupDepth = Math.max(0, groupDepth - 1);
      i += 1;
      continue;
    }
    if (ch === ';' || ((ch === '{' || ch === '}') && !has && isGroupBrace(source, i))) {
      flushCommand('sep');
      i += 1;
      continue;
    }
    if (ch === '&' && source[i + 1] === '>') {
      flushWord();
      i += 1;
      continue;
    }
    if (ch === '&' || ch === '|') {
      const two = source.slice(i, i + 2);
      if (two === '&&' || two === '||') {
        flushCommand(two === '||' ? 'or' : 'sep');
        i += 2;
        continue;
      }
      if (two === '|&') {
        flushCommand('pipe');
        i += 2;
        continue;
      }
      flushCommand(ch === '|' ? 'pipe' : 'bg');
      i += 1;
      continue;
    }
    pushChunk(ch, false);
    i += 1;
  }
  flushCommand('sep');
  return { commands, subs };
}

function isFunctionKeyword(words: readonly ShellWord[]): boolean {
  return words.length === 2 && words[0]?.text === 'function' && FUNCTION_NAME.test(words[1]?.text ?? '');
}

const FUNCTION_NAME = /^[\w:.@%+-]+$/;
const NOT_FUNCTION_NAME = new Set([...RESERVED_PREFIX, 'function', 'case', 'for', 'select', 'in', 'esac', 'fi', 'done']);

/**
 * `name() { body; }`, `name() ( body )`, `function name() { body; }` whose `(` is at `open`.
 * Returns the body text and the index just past the definition.
 */
function functionDefinitionAt(
  source: string,
  open: number,
  words: readonly ShellWord[],
  pending: string | null
): { name: string; body: string; next: number } | null {
  let name: string | null = null;
  const first = words[0]?.text;
  if (pending !== null) {
    if (words.length === 0 || (words.length === 1 && first === 'function')) name = pending;
  } else if (words.length === 1 && first !== 'function') {
    name = first ?? null;
  } else if (words.length === 2 && first === 'function') {
    name = words[1]?.text ?? null;
  }
  if (name === null || !FUNCTION_NAME.test(name) || NOT_FUNCTION_NAME.has(name)) return null;
  let pos = skipBlanks(source, open + 1);
  if (source[pos] !== ')') return null;
  pos = skipBlanks(source, pos + 1);
  if (source[pos] === '{' && isGroupBrace(source, pos)) {
    const end = findMatchingBrace(source, pos);
    const closed = source[end] === '}';
    return { name, body: source.slice(pos + 1, closed ? end : source.length), next: closed ? end + 1 : source.length };
  }
  if (source[pos] === '(') {
    const end = findMatchingParen(source, pos);
    return { name, body: source.slice(pos + 1, end), next: Math.min(end + 1, source.length) };
  }
  return null;
}

/** `{` / `}` are group keywords only as whole words; `{}` and `-I{}` are ordinary word text. */
function isGroupBrace(source: string, index: number): boolean {
  const next = source[index + 1];
  if (source[index] === '{') return next === undefined || /\s/.test(next);
  return next === undefined || /[\s;&|)]/.test(next);
}

function consumeDollarParen(
  source: string,
  start: number,
  subs: string[],
  pushChunk: (chunk: string, fromSingle: boolean) => void,
  onSubstitution: (body: string) => void
): number {
  if (source[start + 2] === '(') {
    const end = findArithmeticEnd(source, start);
    pushChunk(source.slice(start, end), false);
    return end;
  }
  const end = findMatchingParen(source, start + 1);
  onSubstitution(source.slice(start + 2, end));
  return end + 1;
}

/**
 * Result of a substitution that is exactly one `echo` / `printf` of literal words, else null.
 * Variables, pipes, redirects, other commands, globs and nested substitutions are all unknown.
 */
function literalSubstitutionValue(body: string): string | null {
  const lex = lexShell(body);
  const only = lex.commands[0];
  if (lex.subs.length > 0 || lex.commands.length !== 1 || !only) return null;
  if (only.redirects.length > 0 || only.stdin.length > 0 || only.upstream !== null) return null;
  if (only.pipeOut || only.async || only.depth > 0 || only.def) return null;
  const words = only.words;
  const head = words[0]?.text;
  if (words.some((word) => word.dynamic || word.text.includes('$') || word.text.includes('`'))) return null;
  let operands: ShellWord[];
  if (head === 'echo') {
    let first = 1;
    while (/^-[neE]+$/.test(words[first]?.text ?? '')) {
      if (words[first]?.text.includes('e')) return null;
      first += 1;
    }
    operands = words.slice(first);
  } else if (head === 'printf') {
    const format = words[1];
    if (!format || format.text.startsWith('-') || /[%\\]/.test(format.text)) return null;
    operands = [format];
  } else {
    return null;
  }
  if (operands.some((word) => !word.literal && (word.text.startsWith('~') || word.text.includes('{')))) return null;
  const value = operands.map((word) => word.text).join(' ');
  return value.trim() === '' || /[*?[]/.test(value) ? null : value;
}

function findMatchingBrace(source: string, openIdx: number): number {
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let i = openIdx; i < source.length; i += 1) {
    const ch = source[i] ?? '';
    if (quote === "'") {
      if (ch === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === '"') quote = null;
      continue;
    }
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === "'") {
      quote = "'";
      continue;
    }
    if (ch === '"') {
      quote = '"';
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return source.length - 1;
}

function findMatchingParen(source: string, openIdx: number): number {
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let i = openIdx; i < source.length; i += 1) {
    const ch = source[i] ?? '';
    if (quote === "'") {
      if (ch === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === '"') quote = null;
      continue;
    }
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === "'") {
      quote = "'";
      continue;
    }
    if (ch === '"') {
      quote = '"';
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return source.length;
}

function findArithmeticEnd(source: string, start: number): number {
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return source.length;
}

function findBacktick(source: string, start: number): number {
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '\\') {
      i += 1;
      continue;
    }
    if (source[i] === '`') return i;
  }
  return source.length;
}

/** File written by a `>`-style redirection, or null for fd duplication (`>&2`, `2>&-`). */
function redirectTarget(raw: string): string | null {
  let body = raw.trim();
  if (body.startsWith('&')) {
    body = body.slice(1).trim();
    if (/^(?:\d+|-)$/.test(body)) return null;
  } else if (body.startsWith('>') || body.startsWith('|')) {
    body = body.slice(1).trim();
  }
  body = body.replace(/['"]/g, '');
  return body.length > 0 ? body : null;
}

function skipRedirect(source: string, start: number): number {
  let i = start;
  if (source[i] === '&' || source[i] === '>' || source[i] === '|') i += 1;
  while (source[i] === ' ' || source[i] === '\t') i += 1;
  return skipOneWord(source, i);
}

function skipHereString(source: string, start: number): number {
  let i = start;
  while (source[i] === ' ' || source[i] === '\t') i += 1;
  return skipOneWord(source, i);
}

function skipOneWord(source: string, start: number): number {
  let i = start;
  if (i >= source.length) return i;
  const ch = source[i];
  if (ch === '\n' || ch === ';' || ch === '&' || ch === '|' || ch === '(' || ch === ')') return i;
  if (ch === "'" || ch === '"') {
    const quote = ch;
    i += 1;
    while (i < source.length && source[i] !== quote) {
      if (quote === '"' && source[i] === '\\') i += 1;
      i += 1;
    }
    if (source[i] === quote) i += 1;
    return i;
  }
  while (i < source.length && !/[\s;&|()<>]/.test(source[i] ?? '')) i += 1;
  return i;
}

function parseHeredocStart(
  source: string,
  start: number
): { delim: string; stripTabs: boolean; next: number } {
  let i = start + 2;
  let stripTabs = false;
  if (source[i] === '-') {
    stripTabs = true;
    i += 1;
  }
  while (source[i] === ' ' || source[i] === '\t') i += 1;
  let delim = '';
  if (source[i] === "'" || source[i] === '"') {
    const quote = source[i] ?? '';
    i += 1;
    while (i < source.length && source[i] !== quote && source[i] !== '\n') {
      delim += source[i] ?? '';
      i += 1;
    }
    if (source[i] === quote) i += 1;
  } else {
    while (i < source.length && !/[\s;&|<>()]/.test(source[i] ?? '')) {
      delim += source[i] ?? '';
      i += 1;
    }
  }
  return { delim, stripTabs, next: i };
}

function readHeredocBody(
  source: string,
  start: number,
  delim: string,
  stripTabs: boolean
): { text: string; next: number } {
  let i = start;
  const lines: string[] = [];
  while (i < source.length) {
    const nl = source.indexOf('\n', i);
    const line = source.slice(i, nl === -1 ? source.length : nl);
    const cmp = stripTabs ? line.replace(/^\t+/, '') : line;
    if (delim && cmp === delim) {
      return { text: lines.join('\n'), next: nl === -1 ? source.length : nl + 1 };
    }
    lines.push(line);
    if (nl === -1) return { text: lines.join('\n'), next: source.length };
    i = nl + 1;
  }
  return { text: lines.join('\n'), next: i };
}

function unquoteWord(raw: string): string {
  if (raw.length >= 2) {
    const first = raw[0];
    if ((first === "'" || first === '"') && raw[raw.length - 1] === first) return raw.slice(1, -1);
  }
  return raw;
}
