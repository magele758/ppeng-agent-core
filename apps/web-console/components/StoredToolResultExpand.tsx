'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { isToolResultStub, parseToolResultStubRef } from '@/lib/tool-result-stub';

export interface StoredToolResultExpandProps {
  sessionId: string;
  /** Session message id (wire `SessionMessage.id`). */
  messageId?: string;
  partIndex?: number;
  /** Model-view stub line; preferred source for the address. */
  stubText?: string;
  /**
   * When false, only render if `stubText` looks like a dropped-output stub.
   * Default true so Agent A can mount this next to a stub without extra gating.
   */
  requireStub?: boolean;
}

/**
 * Independent Lab control: fetch the stored (full) tool_result by stub address.
 * Keep this outside ChatTurns' existing fold / 「送模视图」 toggle so both can coexist.
 */
export function StoredToolResultExpand({
  sessionId,
  messageId,
  partIndex,
  stubText,
  requireStub = false
}: StoredToolResultExpandProps) {
  const { t } = useI18n();
  const parsed = stubText ? parseToolResultStubRef(stubText) : undefined;
  const mid = parsed?.messageId || messageId;
  const part = parsed?.partIndex ?? partIndex ?? 0;
  const looksLikeStub = Boolean(stubText && isToolResultStub(stubText));
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!sessionId || !mid) return null;
  if (requireStub && !looksLikeStub && !parsed) return null;

  const load = async () => {
    if (text !== null || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({ part: String(part) });
      if (parsed?.seq !== undefined) qs.set('seq', String(parsed.seq));
      const data = (await api(
        `/api/sessions/${encodeURIComponent(sessionId)}/tool-results/${encodeURIComponent(mid)}?${qs}`
      )) as { content?: string };
      setText(typeof data.content === 'string' ? data.content : '');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details
      className="chat-stored-expand"
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open) void load();
      }}
    >
      <summary className="chat-stored-expand__summary">{t('play.stored.expand')}</summary>
      {busy ? <p className="chat-stored-expand__hint muted">{t('common.loading')}</p> : null}
      {err ? <p className="chat-stored-expand__err">{err}</p> : null}
      {text !== null ? <pre className="chat-stored-expand__body">{text}</pre> : null}
    </details>
  );
}
