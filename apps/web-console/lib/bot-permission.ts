/** Bot permission tiers shown in Lab. Same five modes the daemon accepts. */

export const BOT_PERMISSION_MODES = ['plan', 'ask', 'acceptEdits', 'auto', 'bypass'] as const;
export type BotPermissionMode = (typeof BOT_PERMISSION_MODES)[number];

export function parseBotPermissionMode(raw: unknown): BotPermissionMode {
  return BOT_PERMISSION_MODES.find((mode) => mode === raw) ?? 'auto';
}

/** Only moving into bypass from another tier needs an explicit confirmation. */
export function needsBypassConfirm(current: BotPermissionMode, next: BotPermissionMode): boolean {
  return next === 'bypass' && current !== 'bypass';
}

export type BotPolicyWarning =
  | { code: 'missing_required_tools'; tools: string[]; unverifiedMcpTools: string[] }
  | { code: 'stale_allowed_tools'; tools: string[] };

function stringList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((name): name is string => typeof name === 'string') : [];
}

export function parseBotPolicyWarnings(raw: unknown): BotPolicyWarning[] {
  if (!Array.isArray(raw)) return [];
  const out: BotPolicyWarning[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { code, tools, unverifiedMcpTools } = item as {
      code?: unknown;
      tools?: unknown;
      unverifiedMcpTools?: unknown;
    };
    if (!Array.isArray(tools)) continue;
    if (code === 'missing_required_tools') {
      out.push({ code, tools: stringList(tools), unverifiedMcpTools: stringList(unverifiedMcpTools) });
    } else if (code === 'stale_allowed_tools') {
      out.push({ code, tools: stringList(tools) });
    }
  }
  return out;
}

/** The allowlist with stale names dropped. Everything else is kept as saved. */
export function withoutStaleTools(allowedTools: readonly string[], stale: readonly string[]): string[] {
  const drop = new Set(stale);
  return allowedTools.filter((name) => !drop.has(name));
}
