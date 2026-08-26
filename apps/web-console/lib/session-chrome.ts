/** Map Lab autonomy UI → permissionMode */

export type AutonomyLevel = 'supervised' | 'balanced' | 'autonomous';

export type SessionChromeMeta = {
  status: string;
  permissionMode: string;
  usageCostUsd?: number;
  usageTotals?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  goalCondition?: string;
  goalEnabled?: boolean;
  goalTurnsUsed?: number;
  goalMaxTurns?: number;
  goalLedger?: Array<{ met?: boolean; reason?: string }>;
};

export function permissionToAutonomy(mode: string | undefined): AutonomyLevel {
  if (mode === 'ask' || mode === 'plan') return 'supervised';
  if (mode === 'bypass') return 'autonomous';
  return 'balanced';
}

export function autonomyToPermission(level: AutonomyLevel): string {
  if (level === 'supervised') return 'ask';
  if (level === 'autonomous') return 'bypass';
  return 'auto';
}

export function autonomyLabel(level: AutonomyLevel): string {
  if (level === 'supervised') return '全程审批';
  if (level === 'autonomous') return '全自动';
  return '常见自动';
}

export function formatCostUsd(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

export function latestGoalMet(meta: SessionChromeMeta): boolean | null {
  if (!meta.goalEnabled && !meta.goalCondition) return null;
  const ledger = meta.goalLedger;
  if (!Array.isArray(ledger) || !ledger.length) return false;
  const last = ledger[ledger.length - 1];
  return last?.met === true;
}

export function parseSessionChrome(metadata: Record<string, unknown> | undefined, status: string): SessionChromeMeta {
  const m = metadata ?? {};
  const totals = m.usageTotals;
  return {
    status,
    permissionMode: typeof m.permissionMode === 'string' ? m.permissionMode : 'auto',
    usageCostUsd: typeof m.usageCostUsd === 'number' ? m.usageCostUsd : undefined,
    usageTotals:
      totals && typeof totals === 'object'
        ? (totals as SessionChromeMeta['usageTotals'])
        : undefined,
    goalCondition: typeof m.goalCondition === 'string' ? m.goalCondition : undefined,
    goalEnabled: m.goalEnabled === true || (typeof m.goalCondition === 'string' && m.goalCondition.trim().length > 0),
    goalTurnsUsed: typeof m.goalTurnsUsed === 'number' ? m.goalTurnsUsed : undefined,
    goalMaxTurns: typeof m.goalMaxTurns === 'number' ? m.goalMaxTurns : undefined,
    goalLedger: Array.isArray(m.goalLedger) ? (m.goalLedger as SessionChromeMeta['goalLedger']) : undefined
  };
}
