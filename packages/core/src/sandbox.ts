/**
 * Tier 0 Sandbox — Environment variable sanitization for child processes.
 *
 * Strips known-dangerous env vars that enable code/library injection or shell
 * manipulation. Does NOT restrict filesystem/network (that's Tier 1+).
 *
 * Usage:
 *   spawn(cmd, args, { env: sanitizeSpawnEnv() })
 *   spawn(cmd, args, { env: sanitizeSpawnEnv({ overrides: extraEnv }) })
 */

// ---------------------------------------------------------------------------
// Deny-lists
// ---------------------------------------------------------------------------

/** Vars that enable library/code injection in child processes. */
const INJECTION_VARS = new Set([
  // Linux dynamic linker
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'LD_AUDIT',
  // macOS dyld
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'DYLD_FRAMEWORK_PATH',
  'DYLD_FALLBACK_LIBRARY_PATH',
  // Node.js — NODE_OPTIONS can inject --require / --loader
  'NODE_OPTIONS',
  // Python
  'PYTHONPATH',
  'PYTHONSTARTUP',
  'PYTHONHOME',
  // Java
  'JAVA_TOOL_OPTIONS',
  '_JAVA_OPTIONS',
  // Ruby / Perl
  'RUBYLIB',
  'RUBYOPT',
  'PERL5LIB',
  'PERL5OPT',
  // Shell manipulation
  'BASH_ENV',
  'ENV',
  'CDPATH',
  'IFS',
  'PROMPT_COMMAND',
  'GLOBIGNORE',
  'SHELLOPTS',
  'BASHOPTS',
]);

/** Exact credential var names stripped when `stripCredentials` is on. */
const CREDENTIAL_EXACT = new Set([
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AZURE_CLIENT_SECRET',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GITLAB_TOKEN',
  'NPM_TOKEN',
  'NPM_CONFIG_AUTHTOKEN',
]);

/** Prefixes: any var starting with one of these is treated as a credential. */
const CREDENTIAL_PREFIXES = [
  'AWS_SECRET',
  'AWS_SESSION',
  'AZURE_CLIENT_SECRET',
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SanitizeEnvOptions {
  /** Base env to sanitize (defaults to `process.env`). */
  base?: NodeJS.ProcessEnv;
  /** Additional vars merged *after* sanitization of base — intentional overrides. */
  overrides?: NodeJS.ProcessEnv;
  /** Also strip credential-pattern env vars. Default: `false`. */
  stripCredentials?: boolean;
  /** Extra var names to strip (case-sensitive). */
  extraDenylist?: string[];
  /** Var names to preserve even if they'd normally be stripped. */
  allowlist?: string[];
}

/**
 * Produce a sanitized copy of `process.env` safe for child process spawning.
 *
 * By default strips injection vectors (LD_PRELOAD, NODE_OPTIONS, BASH_ENV, …).
 * With `stripCredentials: true` also strips cloud/token credentials.
 */
export function sanitizeSpawnEnv(options?: SanitizeEnvOptions): NodeJS.ProcessEnv {
  const base = { ...(options?.base ?? process.env) };
  const allowSet = options?.allowlist ? new Set(options.allowlist) : undefined;
  const extraDeny = options?.extraDenylist ? new Set(options.extraDenylist) : undefined;

  for (const key of Object.keys(base)) {
    if (allowSet?.has(key)) continue;

    // Injection vars
    if (INJECTION_VARS.has(key)) {
      delete base[key];
      continue;
    }

    // Exported bash functions (BASH_FUNC_xxx%% pattern)
    if (key.startsWith('BASH_FUNC_')) {
      delete base[key];
      continue;
    }

    // Caller-specified denylist
    if (extraDeny?.has(key)) {
      delete base[key];
      continue;
    }

    // Credential stripping (opt-in)
    if (options?.stripCredentials) {
      if (CREDENTIAL_EXACT.has(key)) {
        delete base[key];
        continue;
      }
      for (const prefix of CREDENTIAL_PREFIXES) {
        if (key.startsWith(prefix)) {
          delete base[key];
          break;
        }
      }
    }
  }

  // Merge overrides last — these are intentional additions by the caller.
  if (options?.overrides) {
    for (const [k, v] of Object.entries(options.overrides)) {
      if (v !== undefined) base[k] = v;
    }
  }

  return base;
}

/** Quick helper: names of all vars that would be stripped (for diagnostics/tests). */
export function getInjectionVarNames(): ReadonlySet<string> {
  return INJECTION_VARS;
}
