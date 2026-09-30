/**
 * Builtin catastrophic-command hardline.
 *
 * Checked before bash / bg_run spawn and before every sandbox backend
 * (native, remote VM, microservice). permissionMode bypass / auto cannot
 * skip it, and container backends must not skip it either.
 *
 * Matching is by shell command-word position. Text inside quotes is an
 * argument, not a command (`git commit -m "rm -rf /"` is allowed).
 * There is no user deny-list yet — extend the constants below.
 */

import type { AgentSandboxExecResult, AgentSandboxKind } from './agent-sandbox-types.js';

/** Exact directories whose recursive removal is refused. Extend in code. */
export const HARDLINE_RM_SYSTEM_DIRS = ['/home', '/root', '/etc', '/usr'] as const;

export const HARDLINE_POWER_COMMANDS = ['shutdown', 'reboot', 'halt', 'poweroff'] as const;

export const HARDLINE_ERROR_CODE = 'COMMAND_HARDLINE' as const;

/** Refusal exit status returned when a backend is asked to run a blocked command. */
export const HARDLINE_EXIT_CODE = 126;

const HARDLINE_HINT =
  'Blocked before execution by the builtin command hardline. ' +
  'permissionMode bypass/auto and container or remote sandboxes cannot override this.';

const MAX_SCAN_DEPTH = 8;

const SHELLS = new Set(['bash', 'sh', 'dash', 'zsh', 'ksh', 'ash', 'fish']);

const FORK_BOMB = /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/;

const BLOCK_DEVICE = /^\/dev\/(?:nvme|mmcblk|xvd|sd|hd|vd)/;

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
  | 'kill-minus-one';

export interface CommandHardlineMatch {
  ruleId: CommandHardlineRuleId;
  reason: string;
}

interface ShellWord {
  text: string;
  /** Entirely single-quoted, so ~ and $HOME are literal filenames. */
  literal: boolean;
}

interface LexResult {
  commands: ShellWord[][];
  subs: string[];
}

export function matchCommandHardline(command: string): CommandHardlineMatch | null {
  if (!command || !command.trim()) return null;
  return scanSource(command, 0);
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

function scanSource(source: string, depth: number): CommandHardlineMatch | null {
  if (depth > MAX_SCAN_DEPTH) return null;
  if (FORK_BOMB.test(unquotedText(source))) {
    return { ruleId: 'fork-bomb', reason: 'fork bomb' };
  }
  const lex = lexShell(source);
  for (const argv of lex.commands) {
    const hit = matchArgv(argv, depth);
    if (hit) return hit;
  }
  for (const sub of lex.subs) {
    const hit = scanSource(sub, depth + 1);
    if (hit) return hit;
  }
  return null;
}

function matchArgv(argv: ShellWord[], depth: number): CommandHardlineMatch | null {
  let i = 0;
  while (i < argv.length && isAssignment(argv[i]?.text ?? '')) i += 1;
  i = skipWrappers(argv, i);
  const head = argv[i];
  if (!head) return null;
  const cmd = basename(head.text);
  const args = argv.slice(i + 1);

  if (SHELLS.has(cmd)) {
    const script = shellInlineScript(args);
    if (script !== null) return scanSource(script, depth + 1);
  }
  if (cmd === 'eval' && args.length > 0) {
    return scanSource(args.map((word) => word.text).join(' '), depth + 1);
  }
  if (cmd === 'rm') return matchRm(args);
  if (cmd === 'mkfs' || cmd.startsWith('mkfs.')) {
    return { ruleId: 'mkfs', reason: `blocked ${cmd}` };
  }
  if (cmd === 'dd') return matchDd(args);
  if ((HARDLINE_POWER_COMMANDS as readonly string[]).includes(cmd)) {
    return { ruleId: 'power', reason: `blocked ${cmd}` };
  }
  if (cmd === 'init' || cmd === 'telinit') return matchRunlevel(cmd, args);
  if (cmd === 'systemctl') return matchSystemctl(args);
  if (cmd === 'kill') return matchKill(args);
  return null;
}

function matchRm(args: ShellWord[]): CommandHardlineMatch | null {
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
    const hit = classifyRmTarget(operand);
    if (hit) return hit;
  }
  return null;
}

function classifyRmTarget(word: ShellWord): CommandHardlineMatch | null {
  if (!word.literal && isHomeWipe(word.text)) {
    return { ruleId: 'rm-home', reason: `recursive delete of home (${word.text})` };
  }
  if (!word.text.startsWith('/')) return null;
  const norm = normalizeAbsPath(word.text);
  if (!norm) return null;
  const glob = norm.endsWith('/*');
  const base = glob ? norm.slice(0, -2) || '/' : norm;
  if (base === '/') return { ruleId: 'rm-root', reason: 'recursive delete of /' };
  if ((HARDLINE_RM_SYSTEM_DIRS as readonly string[]).includes(base)) {
    return { ruleId: 'rm-system-dir', reason: `recursive delete of ${base}` };
  }
  return null;
}

function matchDd(args: ShellWord[]): CommandHardlineMatch | null {
  for (const word of args) {
    if (!word.text.startsWith('of=')) continue;
    const dest = word.text.slice(3);
    if (BLOCK_DEVICE.test(dest)) {
      return { ruleId: 'dd-raw-device', reason: `dd writing raw device ${dest}` };
    }
  }
  return null;
}

function matchRunlevel(cmd: string, args: ShellWord[]): CommandHardlineMatch | null {
  const op = firstOperand(args);
  if (op === '0' || op === '6') {
    return { ruleId: 'init-runlevel', reason: `blocked ${cmd} ${op}` };
  }
  return null;
}

function matchSystemctl(args: ShellWord[]): CommandHardlineMatch | null {
  const sub = firstSystemctlVerb(args);
  if (sub === 'poweroff' || sub === 'reboot' || sub === 'halt') {
    return { ruleId: 'systemctl-power', reason: `blocked systemctl ${sub}` };
  }
  return null;
}

function matchKill(args: ShellWord[]): CommandHardlineMatch | null {
  if (args.some((word) => word.text === '-1')) {
    return { ruleId: 'kill-minus-one', reason: 'blocked kill -1' };
  }
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

function firstSystemctlVerb(args: ShellWord[]): string | undefined {
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
  for (let i = 0; i < args.length; i += 1) {
    const text = args[i]?.text;
    if (!text) continue;
    if (text === '--') return args[i + 1]?.text;
    if (text.startsWith('-')) {
      if (takesValue.has(text)) i += 1;
      continue;
    }
    return text;
  }
  return undefined;
}

function shellInlineScript(args: ShellWord[]): string | null {
  for (let i = 0; i < args.length; i += 1) {
    const text = args[i]?.text;
    if (!text) return null;
    if (text === '--') return null;
    if (text === '-c' || text === '--command') return args[i + 1]?.text ?? '';
    if (text.startsWith('-') && !text.startsWith('--')) {
      const cIdx = text.indexOf('c');
      if (cIdx >= 0) {
        const rest = text.slice(cIdx + 1);
        if (rest) return rest;
        return args[i + 1]?.text ?? '';
      }
      continue;
    }
    return null;
  }
  return null;
}

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
        if (flag === '-u' || flag === '--unset') {
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
      while (textAt(i)?.startsWith('-')) i += 1;
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
    if (cmd === 'busybox') {
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
  for (const part of path.split('/')) {
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

function lexShell(source: string): LexResult {
  const commands: ShellWord[][] = [];
  const subs: string[] = [];
  let current: ShellWord[] = [];
  let text = '';
  let literal = true;
  let has = false;
  let quote: "'" | '"' | null = null;

  const resetWord = () => {
    text = '';
    literal = true;
    has = false;
  };

  const flushWord = () => {
    if (!has) {
      resetWord();
      return;
    }
    current.push({ text, literal });
    resetWord();
  };

  const flushCommand = () => {
    flushWord();
    if (current.length > 0) commands.push(current);
    current = [];
  };

  const pushChunk = (chunk: string, fromSingle: boolean) => {
    if (chunk.length === 0) return;
    text += chunk;
    has = true;
    if (!fromSingle) literal = false;
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
        subs.push(source.slice(i + 1, end));
        i = end + 1;
        continue;
      }
      if (ch === '$' && source[i + 1] === '(') {
        i = consumeDollarParen(source, i, subs, pushChunk);
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
      subs.push(source.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    if (ch === '$' && source[i + 1] === '(') {
      i = consumeDollarParen(source, i, subs, pushChunk);
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
      i = end + 1;
      continue;
    }
    if (ch === '<' && source[i + 1] === '<' && source[i + 2] === '<') {
      flushWord();
      i = skipHereString(source, i + 3);
      continue;
    }
    if (ch === '<' && source[i + 1] === '<') {
      flushWord();
      i = skipHeredoc(source, i);
      continue;
    }
    if (ch === '<' || ch === '>') {
      if (/^\d+$/.test(text)) resetWord();
      else flushWord();
      i = skipRedirect(source, i + 1);
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
    if (ch === '\n' || ch === ';' || ch === '(' || ch === ')' || ch === '{' || ch === '}') {
      flushCommand();
      i += 1;
      continue;
    }
    if (ch === '&' || ch === '|') {
      const two = source.slice(i, i + 2);
      if (two === '&&' || two === '||' || two === '|&') {
        flushCommand();
        i += 2;
        continue;
      }
      flushCommand();
      i += 1;
      continue;
    }
    pushChunk(ch, false);
    i += 1;
  }
  flushCommand();
  return { commands, subs };
}

function consumeDollarParen(
  source: string,
  start: number,
  subs: string[],
  pushChunk: (chunk: string, fromSingle: boolean) => void
): number {
  if (source[start + 2] === '(') {
    const end = findArithmeticEnd(source, start);
    pushChunk(source.slice(start, end), false);
    return end;
  }
  const end = findMatchingParen(source, start + 1);
  subs.push(source.slice(start + 2, end));
  return end + 1;
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

function skipHeredoc(source: string, start: number): number {
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
    while (i < source.length && !/[\s;&|<>]/.test(source[i] ?? '')) {
      delim += source[i] ?? '';
      i += 1;
    }
  }
  while (i < source.length && source[i] !== '\n') i += 1;
  if (source[i] === '\n') i += 1;
  if (!delim) return i;
  while (i < source.length) {
    const nl = source.indexOf('\n', i);
    const line = source.slice(i, nl === -1 ? source.length : nl);
    const cmp = stripTabs ? line.replace(/^\t+/, '') : line;
    if (cmp === delim) {
      return nl === -1 ? source.length : nl + 1;
    }
    if (nl === -1) return source.length;
    i = nl + 1;
  }
  return i;
}
