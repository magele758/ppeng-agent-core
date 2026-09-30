/**
 * Bot tool allowlist. Empty / omitted means the full catalog (today's behavior).
 * Names are checked against the live tool catalog before they are stored.
 */

import { ValidationError } from '../errors.js';

export function normalizeAllowedToolNames(
  raw: unknown,
  catalog: readonly { name: string }[]
): string[] {
  if (!Array.isArray(raw)) {
    throw new ValidationError('allowedTools must be an array of tool names');
  }
  const known = new Set(catalog.map((tool) => tool.name));
  const names: string[] = [];
  const unknown: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      unknown.push(String(item));
      continue;
    }
    const name = item.trim();
    if (!name) continue;
    if (!known.has(name)) unknown.push(name);
    else if (!names.includes(name)) names.push(name);
  }
  if (unknown.length > 0) {
    throw new ValidationError(`Unknown tools: ${unknown.join(', ')}`);
  }
  return names;
}

/** Non-empty allowlist, or undefined when the bot should keep the full tool set. */
export function readPositiveAllowedTools(
  metadata: Record<string, unknown> | undefined
): string[] | undefined {
  const raw = metadata?.allowedTools;
  if (!Array.isArray(raw)) return undefined;
  const names = raw
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    .map((name) => name.trim());
  return names.length > 0 ? names : undefined;
}

/** Tools a Bot needs to plan and pull in skills. Missing ones are warned about, not rejected. */
export const BOT_REQUIRED_TOOLS = ['TodoWrite', 'load_skill'] as const;

export interface BotPolicyWarning {
  code: 'missing_required_tools';
  tools: string[];
}

export function botToolAllowlistWarnings(
  allowedTools: readonly string[] | undefined
): BotPolicyWarning[] {
  if (!allowedTools || allowedTools.length === 0) return [];
  const missing = BOT_REQUIRED_TOOLS.filter((name) => !allowedTools.includes(name));
  return missing.length > 0 ? [{ code: 'missing_required_tools', tools: [...missing] }] : [];
}
