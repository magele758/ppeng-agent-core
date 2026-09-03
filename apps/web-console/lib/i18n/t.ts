import type { MessageKey, Messages } from './messages/types';
import { zh } from './messages/zh/index.ts';

const MISSING_KEY_PREFIX = '[i18n] missing key';

function warnMissingKey(key: string): void {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`${MISSING_KEY_PREFIX}: ${key}`);
  }
}

/** `{name}` 替换；未知占位符原样保留 */
export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (matched, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      return String(vars[name]);
    }
    return matched;
  });
}

export function getMessage(messages: Messages, key: string): string | undefined {
  if (!key) return undefined;
  let current: unknown = messages;
  for (const part of key.split('.')) {
    if (current === null || typeof current !== 'object' || !(part in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : undefined;
}

export function translate(
  messages: Messages,
  key: MessageKey | string,
  vars?: Record<string, string | number>,
  fallbackMessages: Messages = zh
): string {
  const primary = getMessage(messages, key);
  if (primary !== undefined) {
    return interpolate(primary, vars);
  }

  const fallback = fallbackMessages === messages ? undefined : getMessage(fallbackMessages, key);
  if (fallback !== undefined) {
    warnMissingKey(key);
    return interpolate(fallback, vars);
  }

  warnMissingKey(key);
  return key;
}
