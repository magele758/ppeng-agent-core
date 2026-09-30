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

const SHELLS = new Set(['bash', 'sh', 'dash', 'zsh', 'ksh', 'ash', 'fish']);

/** `f(){ f|f& };f` in any function name, including the classic `:`. */
const FORK_BOMB = /([\w:.@%+-]+)\s*\(\s*\)\s*\{\s*\1\s*\|\s*\1\s*&\s*\}\s*;\s*\1/;

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
  | 'wipe-device';

export interface CommandHardlineMatch {
  ruleId: CommandHardlineRuleId;
  reason: string;
}

interface ShellWord {
  text: string;
  /** Entirely single-quoted, so ~ and $HOME are literal filenames. */
  literal: boolean;
}

interface ShellCommand {
  words: ShellWord[];
  /** Here-string / heredoc bodies fed to this command's stdin. */
  stdin: string[];
  /** Previous pipeline stage, whose output becomes this command's stdin. */
  upstream: ShellCommand | null;
  /** Targets of output redirections (`>`, `>>`, `>|`, `&>`), quotes removed. */
  redirects: string[];
}

interface LexResult {
  commands: ShellCommand[];
  subs: string[];
}

export function matchCommandHardline(command: string): CommandHardlineMatch | null {
  if (!command || !command.trim()) return null;
  return scanSource(command, 0);
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

function scanSource(source: string, depth: number): CommandHardlineMatch | null {
  if (depth > MAX_SCAN_DEPTH) return null;
  if (FORK_BOMB.test(unquotedText(source))) {
    return { ruleId: 'fork-bomb', reason: 'fork bomb' };
  }
  const lex = lexShell(source);
  for (const command of lex.commands) {
    const hit = matchCommand(command, depth);
    if (hit) return hit;
  }
  for (const sub of lex.subs) {
    const hit = scanSource(sub, depth + 1);
    if (hit) return hit;
  }
  return null;
}

function matchCommand(command: ShellCommand, depth: number): CommandHardlineMatch | null {
  for (const target of command.redirects) {
    if (isRawBlockDevice(target)) {
      return { ruleId: 'raw-device-write', reason: `redirect writing raw device ${target}` };
    }
  }
  const argv = command.words;
  let i = 0;
  for (;;) {
    while (i < argv.length && isAssignment(argv[i]?.text ?? '')) i += 1;
    if (i < argv.length && RESERVED_PREFIX.has(argv[i]?.text ?? '')) {
      i += 1;
      continue;
    }
    const next = skipWrappers(argv, i);
    if (next === i) break;
    i = next;
  }
  const head = argv[i];
  if (!head) return null;
  const cmd = basename(head.text).toLowerCase();
  const args = argv.slice(i + 1);

  if (SHELLS.has(cmd)) {
    const script = shellInlineScript(args);
    if (script !== null) return scanSource(script, depth + 1);
    if (shellReadsStdin(args)) {
      for (const source of stdinSources(command)) {
        const hit = scanSource(source, depth + 1);
        if (hit) return hit;
      }
    }
  }
  if (cmd === 'eval' && args.length > 0) {
    return scanSource(args.map((word) => word.text).join(' '), depth + 1);
  }
  if (cmd === 'rm') return matchRm(args);
  if (cmd === 'find') return matchFind(args);
  if (cmd === 'mkfs' || cmd === 'mke2fs' || cmd.startsWith('mkfs.')) {
    return { ruleId: 'mkfs', reason: `blocked ${cmd}` };
  }
  if (cmd === 'dd') return matchDd(args);
  if (cmd === 'tee') return matchWriteOperands(cmd, args, 'all');
  if (cmd === 'cp' || cmd === 'mv' || cmd === 'install' || cmd === 'rsync') {
    return matchWriteOperands(cmd, args, 'last');
  }
  if (cmd === 'wipefs') return matchWipefs(args);
  if (cmd === 'shred') return matchShred(args);
  if ((HARDLINE_POWER_COMMANDS as readonly string[]).includes(cmd)) {
    return { ruleId: 'power', reason: `blocked ${cmd}` };
  }
  if (cmd === 'init' || cmd === 'telinit') return matchRunlevel(cmd, args);
  if (cmd === 'systemctl' || cmd === 'loginctl') return matchSystemctl(cmd, args);
  if (cmd === 'kill') return matchKill(args);
  if (cmd === 'killall5') return { ruleId: 'kill-minus-one', reason: 'blocked killall5' };
  return null;
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
  if (hostHomeDirs().has(base)) {
    return { ruleId: 'rm-home', reason: `recursive delete of home (${base})` };
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

/** Unfiltered `find <root|system|home> ... -delete` or `-exec rm -r`, which is `rm -rf` by another name. */
function matchFind(args: ShellWord[]): CommandHardlineMatch | null {
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
  const rest = args.slice(i);
  const deletes = rest.some((word) => word.text === '-delete');
  const execRm = rest.some((word, idx) => {
    if (!['-exec', '-execdir', '-ok', '-okdir'].includes(word.text)) return false;
    const target = rest[idx + 1]?.text;
    return target !== undefined && basename(target).toLowerCase() === 'rm';
  });
  if (!deletes && !execRm) return null;
  if (findIsNarrowed(rest)) return null;
  for (const root of roots) {
    const hit = classifyRmTarget(root);
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
    if (isRawBlockDevice(target)) {
      return { ruleId: 'raw-device-write', reason: `${cmd} writing raw device ${target}` };
    }
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

function shellInlineScript(args: ShellWord[]): string | null {
  for (let i = 0; i < args.length; i += 1) {
    const text = args[i]?.text;
    if (!text) return null;
    if (text === '--') return null;
    if (text === '-c' || text === '--command') return args[i + 1]?.text ?? '';
    if (text === '-o' || text === '+o' || text === '-O' || text === '+O') {
      i += 1;
      continue;
    }
    if (text.startsWith('--') || text.startsWith('+')) continue;
    if (text.startsWith('-')) {
      if (text.includes('c')) return args[i + 1]?.text ?? '';
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
  return { words: [], stdin: [], upstream: null, redirects: [] };
}

function lexShell(source: string): LexResult {
  const commands: ShellCommand[] = [];
  const subs: string[] = [];
  let current = newShellCommand();
  let pipePrev: ShellCommand | null = null;
  const pendingHeredocs: PendingHeredoc[] = [];
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
    current.words.push({ text, literal });
    resetWord();
  };

  const flushCommand = (kind: 'pipe' | 'sep' | 'newline') => {
    flushWord();
    if (current.words.length > 0 || current.redirects.length > 0) {
      current.upstream = pipePrev;
      commands.push(current);
      pipePrev = kind === 'pipe' ? current : null;
      current = newShellCommand();
    } else if (kind === 'sep') {
      pipePrev = null;
    }
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
    if (ch === ';' || ch === '(' || ch === ')' || ch === '{' || ch === '}') {
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
        flushCommand('sep');
        i += 2;
        continue;
      }
      if (two === '|&') {
        flushCommand('pipe');
        i += 2;
        continue;
      }
      flushCommand(ch === '|' ? 'pipe' : 'sep');
      i += 1;
      continue;
    }
    pushChunk(ch, false);
    i += 1;
  }
  flushCommand('sep');
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
