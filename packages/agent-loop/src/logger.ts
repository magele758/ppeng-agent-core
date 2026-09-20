/**
 * Minimal logger stub for agent-loop.
 */

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

const noop = () => {};

export function createLogger(_name: string): Logger {
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop
  };
}
