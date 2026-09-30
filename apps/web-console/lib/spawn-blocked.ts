/** spawn_subagent / spawn_teammate results that parked on human approval. */

export interface SpawnBlockedApproval {
  id: string;
  tool?: string;
  reason?: string;
}

export interface SpawnBlocked {
  kind: 'subagent' | 'teammate';
  status?: string;
  sessionId?: string;
  name?: string;
  approvals: SpawnBlockedApproval[];
  blockedTools: string[];
  remediation?: string;
}

const SPAWN_TOOLS = { spawn_subagent: 'subagent', spawn_teammate: 'teammate' } as const;

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function parseSpawnBlocked(toolName: string | undefined, content: string): SpawnBlocked | null {
  const kind = toolName && toolName in SPAWN_TOOLS ? SPAWN_TOOLS[toolName as keyof typeof SPAWN_TOOLS] : undefined;
  if (!kind) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  if (body.blocked !== true) return null;

  const approvals: SpawnBlockedApproval[] = [];
  if (Array.isArray(body.approvals)) {
    for (const item of body.approvals) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const id = str(rec.id);
      if (id) approvals.push({ id, tool: str(rec.tool), reason: str(rec.reason) });
    }
  }
  if (Array.isArray(body.approvalIds)) {
    for (const id of body.approvalIds) {
      if (typeof id === 'string' && id && !approvals.some((a) => a.id === id)) approvals.push({ id });
    }
  }
  const blockedTools = Array.isArray(body.blockedTools)
    ? body.blockedTools.filter((name): name is string => typeof name === 'string')
    : [];
  return {
    kind,
    status: str(body.status),
    sessionId: str(kind === 'teammate' ? body.teammateSessionId : body.childSessionId),
    name: str(body.teammateName),
    approvals,
    blockedTools,
    remediation: str(body.remediation)
  };
}
