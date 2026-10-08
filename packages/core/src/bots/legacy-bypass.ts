/**
 * Bots created before the default moved from bypass to auto got bypass without anyone
 * choosing it. Schema v22 stamps those canonical sessions; the stamp is surfaced as a
 * policy warning and dropped as soon as the owner sets a permission tier explicitly.
 * The mode itself is never downgraded automatically — an autonomous Bot would stall.
 */

/** Session metadata key on a Bot canonical session. */
export const LEGACY_BOT_BYPASS_META = 'legacyBotBypass';

/** First instant bots were no longer created with bypass (commit e013725). */
export const BOT_BYPASS_DEFAULT_ENDED_AT = '2026-09-30T07:58:34.000Z';

/** True when this bypass was assigned by the old default rather than picked by a person. */
export function isDefaultAssignedBypass(metadata: Record<string, unknown> | undefined): boolean {
  if (metadata?.permissionMode !== 'bypass') return false;
  const changedAt = metadata.permissionModeChangedAt;
  return typeof changedAt !== 'string' || changedAt < BOT_BYPASS_DEFAULT_ENDED_AT;
}

export function hasLegacyBypassFlag(metadata: Record<string, unknown> | undefined): boolean {
  return metadata?.[LEGACY_BOT_BYPASS_META] === true && metadata.permissionMode === 'bypass';
}
