/**
 * 流式 SSE 中按时间顺序展示的片段（思考 / 正文 / 工具参数流）。
 */
export type StreamSegment =
  | { kind: 'reasoning'; id: string; text: string }
  | { kind: 'text'; id: string; raw: string; html: string }
  | { kind: 'tool'; id: string; toolCallId: string; name: string; args: string };

export function formatStreamToolArgs(args: string): string {
  const t = args.trim();
  if (!t) return '…';
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return t;
  }
}
