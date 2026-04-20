/**
 * 流式 SSE 中按时间顺序展示的片段（思考 / 正文 / 工具参数流 / A2UI surface）。
 */
export type StreamSegment =
  | { kind: 'reasoning'; id: string; text: string }
  | { kind: 'text'; id: string; raw: string; html: string }
  | { kind: 'tool'; id: string; toolCallId: string; name: string; args: string }
  /**
   * Live A2UI surface accumulating envelopes from `a2ui_message` chunks. The
   * renderer folds them once per render to derive the current SurfaceState.
   * `surfaceId` keys a single segment per surface — a second envelope for the
   * same surface mutates this segment in place rather than appending a new one.
   */
  | { kind: 'a2ui'; id: string; surfaceId: string; catalogId: string; envelopes: unknown[] };

export function formatStreamToolArgs(args: string): string {
  const t = args.trim();
  if (!t) return '…';
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return t;
  }
}
