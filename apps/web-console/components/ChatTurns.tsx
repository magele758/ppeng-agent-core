'use client';

import type { ReactNode } from 'react';
import type { StreamSegment } from '@/lib/stream-segments';
import { formatStreamToolArgs } from '@/lib/stream-segments';
import type { ChatMessage, MessagePart } from '@/lib/types';
import { messageHasStructuredParts, msgPartsToText, normalizedRole } from '@/lib/chat-utils';
import { renderMarkdown } from '@/lib/markdown';
import { A2uiSurface } from './a2ui/A2uiSurface';
import { foldA2uiMessages } from './a2ui/fold';
import { surfacePartKey, useSurfaceContext } from './a2ui/SurfaceContext';
import type { A2uiMessage, SurfaceState } from './a2ui/types';

function buildModClass(
 _role: string,
  stream?: boolean
): string {
  if (stream) return 'chat-turn--streaming';
  const role = _role;
  if (role === 'user') return 'chat-turn--user';
  if (role === 'tool') return 'chat-turn--tool';
  if (role === 'system') return 'chat-turn--system';
  return 'chat-turn--assistant';
}

function avatarText(role: string, stream?: boolean): string {
  if (stream) return 'AI';
  if (role === 'user') return '我';
  if (role === 'tool') return 'T';
  if (role === 'system') return 'S';
  return 'AI';
}

function ToolCallFold({ p }: { p: Extract<MessagePart, { type: 'tool_call' }> }) {
  const body =
    typeof p.input === 'object'
      ? JSON.stringify(p.input ?? {}, null, 2)
      : String(p.input ?? '');
  return (
    <details className="chat-tool-fold chat-tool-fold--call chat-tool-fold--compact">
      <summary className="chat-tool-fold__summary">
        <span className="chat-tool-fold__pill chat-tool-fold__pill--call">调用</span>
        <span className="chat-tool-fold__name">{p.name ?? 'unknown'}</span>
      </summary>
      <pre className="chat-tool-fold__body">{body}</pre>
    </details>
  );
}

/** 与 ToolResultFold 同款交互：独立 `<details>`；流式中展开，输出结束后默认折叠 */
function ReasoningFold({ text, streaming }: { text: string; streaming?: boolean }) {
  const t = text.trim();
  if (!t) return null;
  return (
    <details
      className="chat-tool-fold chat-tool-fold--compact chat-tool-fold--reasoning"
      {...(streaming ? { open: true } : {})}
    >
      <summary className="chat-tool-fold__summary">
        <span className="chat-tool-fold__pill chat-tool-fold__pill--reasoning">思考</span>
        <span className="chat-tool-fold__name">推理过程</span>
      </summary>
      <pre className="chat-tool-fold__body">{t}</pre>
    </details>
  );
}

function ToolResultFold({ p }: { p: Extract<MessagePart, { type: 'tool_result' }> }) {
  const ok = p.ok !== false;
  return (
    <details
      className={`chat-tool-fold chat-tool-fold--result chat-tool-fold--compact ${ok ? 'chat-tool-fold--success' : 'chat-tool-fold--error'}`}
    >
      <summary className="chat-tool-fold__summary">
        <span
          className={`chat-tool-fold__pill ${ok ? 'chat-tool-fold__pill--ok' : 'chat-tool-fold__pill--err'}`}
        >
          {ok ? '输出' : '失败'}
        </span>
        <span className="chat-tool-fold__name">{p.name ?? 'unknown'}</span>
      </summary>
      <pre className="chat-tool-fold__body">{p.content ?? ''}</pre>
    </details>
  );
}

function SurfaceUpdateBlock({
  p,
  sessionId,
  msgIndex,
  partIndex
}: {
  p: Extract<MessagePart, { type: 'surface_update' }>;
  sessionId: string;
  msgIndex: number;
  partIndex: number;
}) {
  /**
   * The same surface may grow across multiple a2ui_render calls (each landing
   * as its own SurfaceUpdatePart on a different tool message). The accumulator
   * provided by SurfaceContext folds them all and tells us which part is the
   * latest position for each surfaceId — only that one renders the surface,
   * earlier positions render a small breadcrumb so the chat history stays
   * readable.
   */
  const ctx = useSurfaceContext();
  const myKey = surfacePartKey(msgIndex, partIndex);
  const latest = ctx.latestKey.get(p.surfaceId);
  const isLatest = latest === myKey;

  if (!isLatest) {
    return (
      <div className="a2ui-debug">
        a2ui surface {p.surfaceId}: superseded by a later update
      </div>
    );
  }

  // Prefer the cross-message accumulated state; fall back to a local fold for
  // standalone parts (covers older sessions or pure-test contexts where the
  // provider is not mounted).
  let state: SurfaceState | undefined = ctx.states.get(p.surfaceId);
  if (!state) {
    state = foldA2uiMessages((p.messages ?? []) as A2uiMessage[]).get(p.surfaceId);
  }
  if (!state) return null;
  return <A2uiSurface state={state} sessionId={sessionId} />;
}

function StructuredBubble({
  parts,
  role,
  sessionId,
  msgIndex
}: {
  parts: MessagePart[];
  role: string;
  sessionId: string;
  msgIndex: number;
}) {
  const usePre = role === 'tool' || role === 'system';
  const nodes: ReactNode[] = [];
  const textBuf: string[] = [];
  const flush = () => {
    const t = textBuf.join('\n').trim();
    textBuf.length = 0;
    if (!t) return;
    if (usePre) {
      nodes.push(
        <pre key={nodes.length} className="chat-bubble__pre">
          {t}
        </pre>
      );
    } else {
      nodes.push(
        <div
          key={nodes.length}
          className="chat-bubble__body chat-bubble__md"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(t) }}
        />
      );
    }
  };
  const partsList = parts ?? [];
  for (let pi = 0; pi < partsList.length; pi += 1) {
    const p = partsList[pi]!;
    if (p.type === 'text') {
      const line = p.text ?? '';
      if (line) textBuf.push(line);
    } else if (p.type === 'reasoning') {
      flush();
      const t = (p.text ?? '').trim();
      if (t) {
        nodes.push(<ReasoningFold key={nodes.length} text={t} />);
      }
    } else if (p.type === 'image') {
      textBuf.push(`[image ${p.assetId ?? ''}${p.mimeType ? ` ${p.mimeType}` : ''}]`);
    } else if (p.type === 'tool_call') {
      flush();
      nodes.push(<ToolCallFold key={nodes.length} p={p} />);
    } else if (p.type === 'tool_result') {
      flush();
      nodes.push(<ToolResultFold key={nodes.length} p={p} />);
    } else if (p.type === 'surface_update') {
      flush();
      nodes.push(
        <SurfaceUpdateBlock
          key={nodes.length}
          p={p}
          sessionId={sessionId}
          msgIndex={msgIndex}
          partIndex={pi}
        />
      );
    }
  }
  flush();
  return <>{nodes}</>;
}

export function ChatTurnFromMessage({
  m,
  sessionId = '',
  msgIndex = 0
}: {
  m: ChatMessage;
  sessionId?: string;
  msgIndex?: number;
}) {
  const r = normalizedRole(m);
  /** 与流式行一致：助手侧（含「调用工具」等结构化气泡）统一不占左侧头像列 */
  const noAvatar = r === 'tool' || r === 'system' || r === 'assistant';
  const bubble =
    messageHasStructuredParts(m.parts) && m.parts ? (
      <div className="chat-bubble--stream-blocks">
        <StructuredBubble parts={m.parts} role={r} sessionId={sessionId} msgIndex={msgIndex} />
      </div>
    ) : r === 'tool' || r === 'system' ? (
      <pre className="chat-bubble__pre">{msgPartsToText(m.parts)}</pre>
    ) : (
      <div
        className="chat-bubble__body chat-bubble__md"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(msgPartsToText(m.parts)) }}
      />
    );
  const artifactBubble = r === 'tool' || r === 'system';
  return (
    <div className={`chat-turn ${buildModClass(r)}${noAvatar ? ' chat-turn--no-avatar' : ''}`}>
      {!noAvatar ? <div className="chat-avatar">{avatarText(r)}</div> : null}
      <div className="chat-turn__content">
        <div className="chat-turn__label">{r}</div>
        <div className={`chat-bubble${artifactBubble ? ' chat-bubble--artifact' : ''}`}>{bubble}</div>
      </div>
    </div>
  );
}

export function ChatTurnPlain({
  role,
  text,
  labelOverride,
  extraClass = ''
}: {
  role: 'user' | 'assistant' | 'tool' | 'system' | 'stream';
  text: string;
  labelOverride?: string;
  extraClass?: string;
}) {
  const stream = role === 'stream';
  const mod = buildModClass(role === 'stream' ? 'assistant' : role, stream);
  const av = avatarText(role === 'stream' ? 'assistant' : role, stream);
  const label = labelOverride ?? (stream ? 'assistant (streaming)' : role);
  const usePre = role === 'tool' || role === 'system';
  const noAvatar =
    role === 'tool' || role === 'system' || role === 'assistant' || role === 'stream';
  return (
    <div className={`chat-turn ${mod} ${noAvatar ? 'chat-turn--no-avatar' : ''} ${extraClass}`.trim()}>
      {!noAvatar ? <div className="chat-avatar">{av}</div> : null}
      <div className="chat-turn__content">
        <div className="chat-turn__label">{label}</div>
        <div className="chat-bubble">
          {usePre ? (
            <pre className="chat-bubble__pre">{text}</pre>
          ) : (
            <div
              className="chat-bubble__body chat-bubble__md"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function ChatTurnStreaming({
  segments,
  typing,
  sessionId = ''
}: {
  segments: StreamSegment[];
  typing?: boolean;
  sessionId?: string;
}) {
  return (
    <div
      className={`chat-turn chat-turn--streaming chat-turn--no-avatar${typing ? ' chat-turn--typing' : ''}`}
    >
      <div className="chat-turn__content">
        <div className="chat-turn__label">assistant (streaming)</div>
        <div className="chat-bubble chat-bubble--stream-blocks">
          {segments.length === 0 ? (
            <div className="chat-stream-placeholder muted">…</div>
          ) : (
            segments.map((seg) => {
              if (seg.kind === 'reasoning') {
                return <ReasoningFold key={seg.id} text={seg.text} streaming />;
              }
              if (seg.kind === 'tool') {
                return (
                  <details key={seg.id} className="chat-tool-fold chat-tool-fold--call chat-tool-fold--compact">
                    <summary className="chat-tool-fold__summary">
                      <span className="chat-tool-fold__pill chat-tool-fold__pill--call">调用</span>
                      <span className="chat-tool-fold__name">{seg.name || 'unknown'}</span>
                    </summary>
                    <pre className="chat-tool-fold__body">{formatStreamToolArgs(seg.args)}</pre>
                  </details>
                );
              }
              if (seg.kind === 'a2ui') {
                const map = foldA2uiMessages(seg.envelopes as A2uiMessage[]);
                const state: SurfaceState | undefined = map.get(seg.surfaceId);
                if (!state) return null;
                return <A2uiSurface key={seg.id} state={state} sessionId={sessionId} />;
              }
              return (
                <div
                  key={seg.id}
                  className="chat-bubble__body chat-bubble__md chat-stream-fold__text"
                  dangerouslySetInnerHTML={{ __html: seg.html }}
                />
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
