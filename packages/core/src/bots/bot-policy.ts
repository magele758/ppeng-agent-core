/**
 * Bot tool allowlist. Empty / omitted means the full catalog (today's behavior).
 * Built-in names are checked against the live tool catalog before they are stored;
 * MCP tool names are accepted even while unregistered, and callers may pass the
 * names of saved PTC dynamic tools, which live outside the static catalog.
 */

import { ValidationError } from '../errors.js';
import { MESSAGE_AGENT_TOOL_NAME } from '../tools/message-agent.js';

const MCP_FIXED_TOOL_NAMES = new Set(['mcp_invoke', 'mcp_list_resources', 'mcp_read_resource']);
const MCP_EXPANDED_TOOL_RE = /^mcp_[hs]\d+_\S+$/;

/** MCP tools register after the first run, so a name can be valid before it is in the catalog. */
export function isMcpToolName(name: string): boolean {
  return MCP_FIXED_TOOL_NAMES.has(name) || MCP_EXPANDED_TOOL_RE.test(name);
}

export function normalizeAllowedToolNames(
  raw: unknown,
  catalog: readonly { name: string }[],
  extraKnownNames: readonly string[] = []
): string[] {
  if (!Array.isArray(raw)) {
    throw new ValidationError('allowedTools must be an array of tool names');
  }
  const known = new Set([...catalog.map((tool) => tool.name), ...extraKnownNames]);
  const names: string[] = [];
  const unknown: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      unknown.push(String(item));
      continue;
    }
    const name = item.trim();
    if (!name) continue;
    if (!known.has(name) && !isMcpToolName(name)) unknown.push(name);
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
export const BOT_REQUIRED_TOOLS = ['TodoWrite', 'load_skill', MESSAGE_AGENT_TOOL_NAME] as const;

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

/** Warnings for a stored bot policy, recomputed on every read so they survive a reload. */
export function botPolicyWarnings(
  metadata: Record<string, unknown> | undefined
): BotPolicyWarning[] {
  return botToolAllowlistWarnings(readPositiveAllowedTools(metadata));
}
