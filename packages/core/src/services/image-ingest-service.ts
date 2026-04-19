/**
 * Image ingest / retention service — extracted from RawAgentRuntime.
 *
 * Owns the surface around adding session-scoped image assets (base64 / URL)
 * and the post-write retention sweep. Message rewriting (warm contact sheet
 * insertion etc.) stays on the runtime because it's tightly coupled to the
 * model call path.
 */
import type { Logger } from '../logger.js';
import type { SqliteStateStore } from '../storage.js';
import type { ImageAssetRecord } from '../types.js';
import { NotFoundError } from '../errors.js';
import {
  fetchImageFromUrl,
  ingestImageAsset,
  maintainImageRetention
} from '../image-assets.js';
import { envInt } from '../env.js';

interface ImageIngestCtx {
  store: SqliteStateStore;
  stateDir: string;
  log: Logger;
  /** Append a system note when retention created a contact-sheet summary. */
  appendSystemNote: (sessionId: string, note: string) => void;
}

export class ImageIngestService {
  constructor(private readonly ctx: ImageIngestCtx) {}

  async ingestBase64(
    sessionId: string,
    input: { dataBase64: string; mimeType: string; sourceUrl?: string }
  ): Promise<ImageAssetRecord> {
    const session = this.ctx.store.getSession(sessionId);
    if (!session) throw new NotFoundError('Session', sessionId);
    const buf = Buffer.from(input.dataBase64, 'base64');
    return ingestImageAsset(this.ctx.store, this.ctx.stateDir, {
      sessionId,
      buffer: buf,
      mimeType: input.mimeType,
      sourceType: input.sourceUrl ? 'url' : 'upload',
      sourceUrl: input.sourceUrl
    });
  }

  async ingestFromUrl(
    sessionId: string,
    imageUrl: string,
    signal?: AbortSignal
  ): Promise<ImageAssetRecord> {
    const session = this.ctx.store.getSession(sessionId);
    if (!session) throw new NotFoundError('Session', sessionId);
    const maxBytes = envInt(process.env, 'RAW_AGENT_IMAGE_MAX_BYTES', 12_000_000);
    const timeoutMs = envInt(process.env, 'RAW_AGENT_IMAGE_FETCH_TIMEOUT_MS', 30_000);
    const { buffer, mimeType } = await fetchImageFromUrl(imageUrl, maxBytes, timeoutMs, signal);
    return ingestImageAsset(this.ctx.store, this.ctx.stateDir, {
      sessionId,
      buffer,
      mimeType,
      sourceType: 'url',
      sourceUrl: imageUrl
    });
  }

  /** Run maintenance + emit a system note when a fresh contact sheet was generated. */
  async runRetention(sessionId: string): Promise<void> {
    const session = this.ctx.store.getSession(sessionId);
    if (!session) return;
    try {
      const r = await maintainImageRetention({
        store: this.ctx.store,
        stateDir: this.ctx.stateDir,
        session
      });
      if (r.contactAsset && r.summaryNote) {
        this.ctx.appendSystemNote(sessionId, r.summaryNote);
      }
    } catch (e) {
      this.ctx.log.error('image retention failed', e);
    }
  }
}
