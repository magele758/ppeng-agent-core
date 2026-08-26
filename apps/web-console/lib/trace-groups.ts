export type TraceRow = { kind: string; ts: string; payload?: unknown };

export type TraceGroup = {
  id: string;
  label: string;
  startTs: string;
  endTs: string;
  durationMs: number | null;
  events: TraceRow[];
  hasError: boolean;
};

const ERROR_KINDS = new Set([
  'model_error',
  'recovery_abort',
  'cancel',
  'turn_truncated',
  'refusal_preservation'
]);

function isErrorKind(kind: string): boolean {
  if (ERROR_KINDS.has(kind)) return true;
  return kind.includes('error') || kind.includes('fail');
}

function errorHint(kind: string, payload: unknown): { what: string; why: string; next: string } {
  const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const msg = typeof p.message === 'string' ? p.message : typeof p.error === 'string' ? p.error : '';
  switch (kind) {
    case 'model_error':
      return {
        what: '模型调用失败',
        why: msg || '上游返回错误或超时',
        next: '检查模型配置 / 重试本轮 / 缩短上下文'
      };
    case 'recovery_abort':
      return {
        what: '循环保护中止',
        why: msg || '重复工具或失败 streak 触发 LoopGuard',
        next: '改写目标、换工具，或提高 recovery 预算后重试'
      };
    case 'cancel':
      return { what: '用户取消', why: '会话被主动停止', next: '必要时重新 Run 或发送新消息' };
    case 'turn_truncated':
      return {
        what: '输出被截断',
        why: msg || '触及 token / max_tokens 上限',
        next: '提高上限、要求模型更短，或拆成多步任务'
      };
    default:
      return {
        what: `事件 ${kind}`,
        why: msg || '见 payload 详情',
        next: '展开 payload 排查，或从 Play 重试'
      };
  }
}

/** Group chronological events into turns (turn_start…turn_end) with loose buckets. */
export function groupTraceEvents(rows: TraceRow[]): TraceGroup[] {
  const sorted = [...rows].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  const groups: TraceGroup[] = [];
  let current: TraceGroup | null = null;
  let turnIdx = 0;

  const flush = () => {
    if (!current) return;
    const start = Date.parse(current.startTs);
    const end = Date.parse(current.endTs);
    current.durationMs = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
    groups.push(current);
    current = null;
  };

  for (const ev of sorted) {
    if (ev.kind === 'turn_start' || !current) {
      if (current) flush();
      turnIdx += 1;
      current = {
        id: `turn-${turnIdx}-${ev.ts}`,
        label: ev.kind === 'turn_start' ? `Turn ${turnIdx}` : `Span ${turnIdx}`,
        startTs: ev.ts,
        endTs: ev.ts,
        durationMs: null,
        events: [ev],
        hasError: isErrorKind(ev.kind)
      };
      continue;
    }
    current.events.push(ev);
    current.endTs = ev.ts;
    if (isErrorKind(ev.kind)) current.hasError = true;
    if (ev.kind === 'turn_end' || ev.kind === 'cancel') {
      flush();
    }
  }
  flush();
  return groups;
}

export function maxDurationMs(groups: TraceGroup[]): number {
  let m = 1;
  for (const g of groups) {
    if (g.durationMs != null && g.durationMs > m) m = g.durationMs;
  }
  return m;
}

export { isErrorKind, errorHint };
