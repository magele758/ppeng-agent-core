/**
 * Lightweight structured logger with namespace support.
 *
 * Two output formats — controlled by `RAW_AGENT_LOG_FORMAT`:
 *   - `pretty` (default): human-readable `[ns] message …` via console.
 *   - `json`            : one JSON line per call to stdout/stderr, suitable
 *                         for log aggregators (Loki, CloudWatch, Datadog).
 *
 * Level filtering via `RAW_AGENT_LOG_LEVEL` (debug|info|warn|error|silent).
 *
 * Usage:
 *   const log = createLogger('self-heal');
 *   log.info('run started', runId);
 *   log.warn('multiple concurrent runs', { count: 3 });
 *   log.error('scheduler failed', err);
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

function parseLevel(raw: string | undefined): LogLevel {
  if (!raw) return 'info';
  const lower = raw.toLowerCase().trim() as LogLevel;
  return lower in LEVEL_ORDER ? lower : 'info';
}

let globalLevel: LogLevel | undefined;

function getLevel(): LogLevel {
  if (globalLevel !== undefined) return globalLevel;
  return parseLevel(process.env.RAW_AGENT_LOG_LEVEL);
}

/** Override the global log level (useful for tests). */
export function setLogLevel(level: LogLevel): void {
  globalLevel = level;
}

/** Reset to env-based detection. */
export function resetLogLevel(): void {
  globalLevel = undefined;
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

function isJsonMode(): boolean {
  const v = process.env.RAW_AGENT_LOG_FORMAT?.toLowerCase().trim();
  return v === 'json' || v === 'ndjson';
}

/** Convert variadic console-style args into a structured `{msg, extra?}` pair. */
function structureArgs(args: unknown[]): { msg: string; extra: unknown[] } {
  const extra: unknown[] = [];
  const messageParts: string[] = [];
  for (const arg of args) {
    if (typeof arg === 'string') {
      messageParts.push(arg);
      continue;
    }
    if (arg instanceof Error) {
      // Capture the most useful Error fields without tripping over circular refs.
      extra.push({
        error: { name: arg.name, message: arg.message, stack: arg.stack }
      });
      messageParts.push(arg.message);
      continue;
    }
    extra.push(arg);
  }
  return { msg: messageParts.join(' ') || '(no message)', extra };
}

function emitJson(level: LogLevel, ns: string, args: unknown[], stream: NodeJS.WriteStream): void {
  const { msg, extra } = structureArgs(args);
  const line = {
    ts: new Date().toISOString(),
    level,
    ns,
    msg,
    ...(extra.length ? { extra } : {})
  };
  try {
    stream.write(JSON.stringify(line) + '\n');
  } catch {
    // Fall back to pretty output if a payload contains a circular structure
    // we couldn't serialize — prevents the logger from itself crashing the host.
    stream.write(`(json-log-fallback) [${ns}] ${msg}\n`);
  }
}

/** Create a namespaced logger. */
export function createLogger(namespace: string): Logger {
  const prefix = `[${namespace}]`;

  function shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[getLevel()];
  }

  function emit(level: LogLevel, args: unknown[]): void {
    if (!shouldLog(level)) return;
    if (isJsonMode()) {
      // info/debug → stdout, warn/error → stderr (default Pino-style routing).
      const stream = level === 'warn' || level === 'error' ? process.stderr : process.stdout;
      emitJson(level, namespace, args, stream);
      return;
    }
    switch (level) {
      case 'debug': console.debug(prefix, ...args); return;
      case 'info': console.log(prefix, ...args); return;
      case 'warn': console.warn(prefix, ...args); return;
      case 'error': console.error(prefix, ...args); return;
      default: /* silent */ return;
    }
  }

  return {
    debug(...args) { emit('debug', args); },
    info(...args) { emit('info', args); },
    warn(...args) { emit('warn', args); },
    error(...args) { emit('error', args); }
  };
}
