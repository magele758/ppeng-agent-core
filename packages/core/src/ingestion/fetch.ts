import { preClassifyKind } from './classify.js';
import type { IngestionPorts } from './ports.js';
import type { FetchedPayload, RawAttachment } from './types.js';

function stripDataUrl(b64: string): string {
  const t = b64.trim();
  if (!t.startsWith('data:')) return t;
  const comma = t.indexOf(',');
  return comma >= 0 ? t.slice(comma + 1) : '';
}

export async function fetchPayload(raw: RawAttachment, ports: IngestionPorts): Promise<FetchedPayload> {
  const kind = preClassifyKind(raw);
  const { fileName, spec } = raw;
  const maxBytes = ports.settings.maxBytes;

  if (kind === 'unsupported') {
    return {
      skip: true,
      skipReason: `不支持的附件类型: ${fileName}`
    };
  }

  if (spec.via === 'none') {
    return { skip: true, skipReason: '缺少 base64 或 url' };
  }

  if (typeof raw.declaredSize === 'number' && raw.declaredSize > maxBytes) {
    return {
      error: `文件过大（${(raw.declaredSize / 1024 / 1024).toFixed(1)}MB，超过 ${(maxBytes / 1024 / 1024).toFixed(0)}MB 上限）`
    };
  }

  if (spec.via === 'upload') {
    try {
      const buf = Buffer.from(stripDataUrl(spec.base64), 'base64');
      if (buf.length > maxBytes) {
        return {
          error: `文件过大（${(buf.length / 1024 / 1024).toFixed(1)}MB，超过 ${(maxBytes / 1024 / 1024).toFixed(0)}MB 上限）`
        };
      }
      return { buffer: buf, mimeType: spec.mimeType ?? raw.mimeType };
    } catch {
      return { error: `base64 解码失败: ${fileName}` };
    }
  }

  const dl = await ports.download(spec.url, maxBytes);
  if (!dl.ok || !dl.buffer) {
    return { error: dl.error || `下载失败: ${fileName}` };
  }
  return { buffer: dl.buffer, mimeType: dl.mimeType ?? spec.mimeType ?? raw.mimeType, url: spec.url };
}
