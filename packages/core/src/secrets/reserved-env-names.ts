/**
 * Vault names must not override process / linker / interpreter switches.
 */

export const ENV_NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

const RESERVED_PREFIXES = ['LD_', 'DYLD_'];

const RESERVED_EXACT = new Set([
  'PATH',
  'HOME',
  'PWD',
  'OLDPWD',
  'TMPDIR',
  'TEMP',
  'TMP',
  'USER',
  'LOGNAME',
  'SHELL',
  'IFS',
  'BASH_ENV',
  'ENV',
  'PROMPT_COMMAND',
  'SHELLOPTS',
  'NODE_OPTIONS',
  'NODE_PATH',
  'PYTHONPATH',
  'PYTHONSTARTUP',
  'PYTHONHOME',
  'RUBYOPT',
  'RUBYLIB',
  'PERL5OPT',
  'PERL5LIB'
]);

export function isReservedEnvName(name: string): boolean {
  const upper = name.toUpperCase();
  if (RESERVED_EXACT.has(upper)) return true;
  return RESERVED_PREFIXES.some((prefix) => upper.startsWith(prefix));
}

export const RESERVED_ENV_NAME_HINT =
  '该名字是执行环境保留名（PATH / HOME / LD_* / NODE_OPTIONS 等），不能作为凭据存储。';

export const ENV_NAME_GRAMMAR_HINT = 'name 须为大写字母开头的 ENV 风格标识（A-Z0-9_，≤64 字符）';

export function assertWritableEnvName(name: string): void {
  if (!ENV_NAME_RE.test(name)) {
    throw new Error(ENV_NAME_GRAMMAR_HINT);
  }
  if (isReservedEnvName(name)) {
    throw new Error(RESERVED_ENV_NAME_HINT);
  }
}

export function stripReservedEnvNames(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    if (!isReservedEnvName(name)) out[name] = value;
  }
  return out;
}
