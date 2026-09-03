import type { ChatMessage } from '@/lib/types';
import type { StreamSegment } from '@/lib/stream-segments';
import { formatStreamToolArgs } from '@/lib/stream-segments';

export type ActivityToolPhase = 'announce' | 'running' | 'result' | 'error';

export type ActivityToolItem = {
  id: string;
  name: string;
  phase: ActivityToolPhase;
  argsPreview: string;
  resultPreview?: string;
  ok?: boolean;
};

function preview(text: string, max = 280): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/** Build activity cards from history + live stream (newest last). */
export function collectActivityTools(
  messages: ChatMessage[],
  streamSegments: StreamSegment[] | null | undefined
): ActivityToolItem[] {
  const items: ActivityToolItem[] = [];
  const byCallId = new Map<string, number>();

  for (let mi = 0; mi < messages.length; mi += 1) {
    const m = messages[mi]!;
    for (let pi = 0; pi < (m.parts?.length ?? 0); pi += 1) {
      const p = m.parts![pi]!;
      if (p.type === 'tool_call') {
        const callId = String(p.toolCallId || `${mi}-${pi}-${p.name}`);
        const args =
          typeof p.input === 'object' ? JSON.stringify(p.input ?? {}, null, 2) : String(p.input ?? '');
        const item: ActivityToolItem = {
          id: callId,
          name: p.name ?? 'unknown',
          phase: 'announce',
          argsPreview: preview(args)
        };
        byCallId.set(callId, items.length);
        items.push(item);
      } else if (p.type === 'tool_result') {
        const callId = String(p.toolCallId || `${mi}-${pi}-result`);
        const idx = byCallId.get(callId);
        const resultPreview = preview(String(p.content ?? ''));
        const ok = p.ok !== false;
        if (idx !== undefined) {
          items[idx] = {
            ...items[idx]!,
            phase: ok ? 'result' : 'error',
            resultPreview,
            ok
          };
        } else {
          items.push({
            id: callId,
            name: p.name ?? 'unknown',
            phase: ok ? 'result' : 'error',
            argsPreview: '',
            resultPreview,
            ok
          });
        }
      }
    }
  }

  for (const s of streamSegments ?? []) {
    if (s.kind !== 'tool') continue;
    const existing = byCallId.get(s.toolCallId);
    const argsPreview = preview(formatStreamToolArgs(s.args));
    if (existing !== undefined) {
      items[existing] = {
        ...items[existing]!,
        name: s.name || items[existing]!.name,
        phase: 'running',
        argsPreview: argsPreview || items[existing]!.argsPreview
      };
    } else {
      byCallId.set(s.toolCallId, items.length);
      items.push({
        id: s.toolCallId,
        name: s.name || 'unknown',
        phase: 'running',
        argsPreview
      });
    }
  }

  return items.slice(-40);
}

export type ArtifactItem = {
  id: string;
  kind: 'a2ui' | 'image' | 'file';
  label: string;
  surfaceId?: string;
  downloadHref?: string;
  handle?: string;
};

export function collectArtifacts(
  messages: ChatMessage[],
  streamSegments: StreamSegment[] | null | undefined,
  pendingImageIds: string[],
  extraFiles?: Array<{ id: string; title?: string; handle?: string }>
): ArtifactItem[] {
  const out: ArtifactItem[] = [];
  const seen = new Set<string>();

  for (const f of extraFiles ?? []) {
    const handle = f.handle || f.id;
    const key = `file:${handle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: key,
      kind: 'file',
      label: f.title || handle.slice(0, 28),
      handle,
      downloadHref: `/api/artifact/${encodeURIComponent(handle)}/download`
    });
  }

  for (const id of pendingImageIds) {
    const key = `img:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: key, kind: 'image', label: `图片 ${id.slice(0, 10)}…` });
  }

  for (const m of messages) {
    for (const p of m.parts ?? []) {
      if (p.type === 'surface_update' && p.surfaceId) {
        const key = `a2ui:${p.surfaceId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ id: key, kind: 'a2ui', label: `Surface ${p.surfaceId}`, surfaceId: p.surfaceId });
      }
      if (p.type === 'image' && p.assetId) {
        const aid = p.assetId;
        const key = `img:${aid}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ id: key, kind: 'image', label: `图片 ${aid.slice(0, 10)}…` });
      }
      if (p.type === 'text' || p.type === 'tool_result') {
        const text = p.type === 'text' ? p.text : p.content;
        const handles = String(text ?? '').matchAll(/Artifact Handle: `([^`]+)`/g);
        for (const m of handles) {
          const handle = m[1]!;
          const key = `file:${handle}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            id: key,
            kind: 'file',
            label: handle.slice(0, 28),
            handle,
            downloadHref: `/api/artifact/${encodeURIComponent(handle)}/download`
          });
        }
      }
    }
  }

  for (const s of streamSegments ?? []) {
    if (s.kind !== 'a2ui') continue;
    const key = `a2ui:${s.surfaceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: key, kind: 'a2ui', label: `Surface ${s.surfaceId}`, surfaceId: s.surfaceId });
  }

  return out.slice(-30);
}
