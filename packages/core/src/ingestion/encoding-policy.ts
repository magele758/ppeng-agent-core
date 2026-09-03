/**
 * SoT for bytes→string. UTF-8 first; obvious replacement-char density falls back to GBK
 * via ICU TextDecoder (no iconv-lite). Lab setting can disable the fallback.
 */

export function decodeTextBytes(
  buf: Buffer,
  gbkFallback = true
): { text: string; encoding: 'utf-8' | 'gbk' } {
  const utf8 = buf.toString('utf-8');
  if (!gbkFallback) {
    return { text: utf8, encoding: 'utf-8' };
  }
  const replacements = (utf8.match(/�/g) || []).length;
  if (utf8.length > 0 && replacements / utf8.length > 0.01) {
    try {
      const gbk = new TextDecoder('gbk').decode(buf);
      const gbkReplacements = (gbk.match(/�/g) || []).length;
      if (gbkReplacements < replacements) return { text: gbk, encoding: 'gbk' };
    } catch {
      /* ICU without gbk — keep utf-8 */
    }
  }
  return { text: utf8, encoding: 'utf-8' };
}

/** NUL, or too many non-printable bytes in the first 4KB. */
export function looksBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, 4096);
  if (sample.length === 0) return false;
  let suspicious = 0;
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i]!;
    if (b === 0) return true;
    if (b < 9 || (b > 13 && b < 32)) suspicious++;
  }
  return suspicious / sample.length > 0.1;
}
