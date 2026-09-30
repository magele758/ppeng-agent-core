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

export type BotPolicyWarning = { code: 'missing_required_tools'; tools: string[] };

export function parseBotPolicyWarnings(raw: unknown): BotPolicyWarning[] {
  if (!Array.isArray(raw)) return [];
  const out: BotPolicyWarning[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { code, tools } = item as { code?: unknown; tools?: unknown };
    if (code !== 'missing_required_tools' || !Array.isArray(tools)) continue;
    out.push({
      code,
      tools: tools.filter((name): name is string => typeof name === 'string')
    });
  }
  return out;
}
