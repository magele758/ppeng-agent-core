/**
 * Lightweight structured logger with namespace support.
 * Zero dependencies — thin wrapper over console with level filtering.
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

/** Create a namespaced logger. */
export function createLogger(namespace: string): Logger {
  const prefix = `[${namespace}]`;

  function shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[getLevel()];
  }

  return {
    debug(...args: unknown[]) {
      if (shouldLog('debug')) console.debug(prefix, ...args);
    },
    info(...args: unknown[]) {
      if (shouldLog('info')) console.log(prefix, ...args);
    },
    warn(...args: unknown[]) {
      if (shouldLog('warn')) console.warn(prefix, ...args);
    },
    error(...args: unknown[]) {
      if (shouldLog('error')) console.error(prefix, ...args);
    },
  };
}
