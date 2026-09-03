import type { RawAttachment, SourceSpec } from './types.js';

export interface AttachmentInput {
  fileName?: string;
  mimeType?: string;
  base64?: string;
  url?: string;
  declaredSize?: number;
}

function stripDataUrl(b64: string): string {
  const t = b64.trim();
  if (!t.startsWith('data:')) return t;
  const comma = t.indexOf(',');
  return comma >= 0 ? t.slice(comma + 1) : '';
}

/**
 * Normalize wire inputs (base64 upload and/or URL) into a single RawAttachment list.
 * Order is preserved (C2).
 */
export function normalizeAttachments(inputs?: AttachmentInput[]): RawAttachment[] {
  const raws: RawAttachment[] = [];
  let index = 0;
  for (const file of inputs ?? []) {
    const fileName = (file.fileName || `file_${index}`).trim() || `file_${index}`;
    const hasBase64 = typeof file.base64 === 'string' && file.base64.trim().length > 0;
    const hasUrl = typeof file.url === 'string' && file.url.trim().length > 0;
    let spec: SourceSpec;
    if (hasBase64) {
      spec = { via: 'upload', base64: stripDataUrl(file.base64!), mimeType: file.mimeType };
    } else if (hasUrl) {
      spec = { via: 'url', url: file.url!.trim(), mimeType: file.mimeType };
    } else {
      spec = { via: 'none' };
    }
    raws.push({
      source: hasBase64 ? 'upload' : hasUrl ? 'url' : 'upload',
      fileName,
      index: index++,
      spec,
      declaredSize: typeof file.declaredSize === 'number' ? file.declaredSize : undefined,
      mimeType: file.mimeType
    });
  }
  return raws;
}
