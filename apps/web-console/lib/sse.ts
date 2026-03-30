/**
 * 累加 SSE 帧并解析 event/data 块。
 */
export function feedSseBuffer(
  buf: string,
  chunk: Uint8Array,
  decoder: TextDecoder,
  onEvent: (event: string, payload: unknown) => void
): string {
  let next = buf + decoder.decode(chunk, { stream: true });
  const parts = next.split('\n\n');
  const tail = parts.pop() ?? '';
  for (const block of parts) {
    const m = block.match(/^event:\s*(\S+)\ndata:\s*(.+)$/ms);
    if (!m) continue;
    let payload: unknown;
    try {
      payload = JSON.parse(m[2]);
    } catch {
      continue;
    }
    onEvent(m[1], payload);
  }
  return tail;
}
