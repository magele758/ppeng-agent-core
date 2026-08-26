/**
 * 累加 SSE 帧并解析 `event:`/`data:` 块。与 apps/web-console `lib/sse.ts` 保持一致，
 * 供 Node 端（CLI 等）共享同一套解析逻辑。
 */
export function feedSseBuffer(
  buf: string,
  chunk: Uint8Array,
  decoder: TextDecoder,
  onEvent: (event: string, payload: unknown) => void
): string {
  const next = buf + decoder.decode(chunk, { stream: true });
  const parts = next.split('\n\n');
  const tail = parts.pop() ?? '';
  for (const block of parts) {
    const m = block.match(/^event:\s*(\S+)\ndata:\s*(.+)$/ms);
    const eventName = m?.[1];
    const rawData = m?.[2];
    if (!eventName || rawData === undefined) continue;
    let payload: unknown;
    try {
      payload = JSON.parse(rawData);
    } catch {
      continue;
    }
    onEvent(eventName, payload);
  }
  return tail;
}
