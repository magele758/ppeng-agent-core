import type { AttachmentKind } from './types.js';

export interface AttachmentStatus {
  fileName: string;
  index: number;
  state: 'parsing' | 'ready' | 'degraded' | 'failed';
  kind?: AttachmentKind;
  encoding?: 'utf-8' | 'gbk';
  reason?: string;
}

export interface StatusSink {
  sendAttachmentStatus(status: AttachmentStatus): void;
}

export function emitAttachmentStatus(sink: StatusSink | undefined, status: AttachmentStatus): void {
  try {
    sink?.sendAttachmentStatus(status);
  } catch {
    /* status send must not fail the pipeline */
  }
}
