import { classify } from './classify.js';
import { decode } from './decode.js';
import { emit, type EmitResult } from './emit.js';
import { fetchPayload } from './fetch.js';
import { normalizeAttachments, type AttachmentInput } from './normalize.js';
import { emitAttachmentStatus, type AttachmentStatus, type StatusSink } from './status.js';
import { route, type RouteContext } from './route.js';
import type { IngestionPorts } from './ports.js';
import type { IngestContentPart, RawAttachment, ResolvedAttachment } from './types.js';

export interface RunIngestionInput {
  files?: AttachmentInput[];
  ports: IngestionPorts;
  message?: StatusSink;
}

interface ProcessedResult extends EmitResult {
  resolved: ResolvedAttachment;
}

export interface IngestionRunResult {
  contentParts: IngestContentPart[];
  imageCount: number;
  imageAssetIds: string[];
  statuses: AttachmentStatus[];
  resolved: ResolvedAttachment[];
}

export async function runIngestion(input: RunIngestionInput): Promise<IngestionRunResult> {
  const raws = normalizeAttachments(input.files);
  const contentParts: IngestContentPart[] = [];
  const statuses: AttachmentStatus[] = [];
  const resolved: ResolvedAttachment[] = [];
  const imageAssetIds: string[] = [];
  let imageCount = 0;
  if (raws.length === 0) {
    return { contentParts, imageCount, imageAssetIds, statuses, resolved };
  }

  const routeCtx: RouteContext = { ports: input.ports };
  const settled = await Promise.allSettled(raws.map((raw) => processOne(raw, routeCtx, input.message)));

  const processed: ProcessedResult[] = [];
  settled.forEach((res, i) => {
    if (res.status === 'fulfilled') {
      processed.push(res.value);
    } else {
      const raw = raws[i]!;
      const reason = (res.reason as Error)?.message || '处理失败';
      const status: AttachmentStatus = { fileName: raw.fileName, index: raw.index, state: 'failed', reason };
      emitAttachmentStatus(input.message, status);
      statuses.push(status);
    }
  });

  processed.sort((a, b) => a.index - b.index);
  for (const r of processed) {
    if (r.fatalError) throw r.fatalError;
    contentParts.push(...r.parts);
    imageCount += r.images;
    statuses.push(...r.statuses);
    resolved.push(r.resolved);
    for (const p of r.parts) {
      if (p.type === 'image') imageAssetIds.push(p.imageAssetId);
    }
  }

  return { contentParts, imageCount, imageAssetIds, statuses, resolved };
}

async function processOne(
  raw: RawAttachment,
  ctx: RouteContext,
  message: StatusSink | undefined
): Promise<ProcessedResult> {
  try {
    const fetched = await fetchPayload(raw, ctx.ports);
    const classified = classify(raw, fetched);
    if (!fetched.skip && !fetched.error && classified.kind === 'rawtext') {
      emitAttachmentStatus(message, {
        fileName: raw.fileName,
        index: raw.index,
        state: 'parsing',
        kind: classified.kind
      });
    }
    const decoded = decode(classified, ctx.ports.settings.gbkFallback);
    const resolved = await route(decoded, ctx);
    const result = emit(resolved);
    for (const s of result.statuses) emitAttachmentStatus(message, s);
    return { ...result, resolved };
  } catch (e) {
    const reason = (e as Error)?.message || '处理失败';
    emitAttachmentStatus(message, { fileName: raw.fileName, index: raw.index, state: 'failed', reason });
    return {
      index: raw.index,
      parts: [],
      images: 0,
      statuses: [],
      resolved: { ...raw, fetched: {}, kind: 'unsupported', route: { mode: 'skip', reason } }
    };
  }
}
