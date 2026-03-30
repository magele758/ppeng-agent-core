'use client';

import type { ReactNode } from 'react';
import type { ChatMessage, MessagePart } from '@/lib/types';
import { messageHasToolParts, msgPartsToText, normalizedRole } from '@/lib/chat-utils';
import { renderMarkdown } from '@/lib/markdown';

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
    <details className="chat-tool-fold">
      <summary className="chat-tool-fold__summary">调用工具 · {p.name ?? 'unknown'}</summary>
      <pre className="chat-tool-fold__body">{body}</pre>
    </details>
  );
}

function ToolResultFold({ p }: { p: Extract<MessagePart, { type: 'tool_result' }> }) {
  const ok = p.ok !== false;
  return (
    <details className="chat-tool-fold chat-tool-fold--result">
      <summary className="chat-tool-fold__summary">
        {ok ? `工具输出 · ${p.name ?? 'unknown'}` : `工具输出 · ${p.name ?? 'unknown'}（失败）`}
      </summary>
      <pre className="chat-tool-fold__body">{p.content ?? ''}</pre>
    </details>
  );
}

function StructuredBubble({ parts, role }: { parts: MessagePart[]; role: string }) {
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
  for (const p of parts ?? []) {
    if (p.type === 'text') {
      const line = p.text ?? '';
      if (line) textBuf.push(line);
    } else if (p.type === 'image') {
      textBuf.push(`[image ${p.assetId ?? ''}${p.mimeType ? ` ${p.mimeType}` : ''}]`);
    } else if (p.type === 'tool_call') {
      flush();
      nodes.push(<ToolCallFold key={nodes.length} p={p} />);
    } else if (p.type === 'tool_result') {
      flush();
      nodes.push(<ToolResultFold key={nodes.length} p={p} />);
    }
  }
  flush();
  return <>{nodes}</>;
}

export function ChatTurnFromMessage({ m }: { m: ChatMessage }) {
  const r = normalizedRole(m);
  const bubble =
    messageHasToolParts(m.parts) && m.parts ? (
      <StructuredBubble parts={m.parts} role={r} />
    ) : r === 'tool' || r === 'system' ? (
      <pre className="chat-bubble__pre">{msgPartsToText(m.parts)}</pre>
    ) : (
      <div
        className="chat-bubble__body chat-bubble__md"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(msgPartsToText(m.parts)) }}
      />
    );
  return (
    <div className={`chat-turn ${buildModClass(r)}`}>
      <div className="chat-avatar">{avatarText(r)}</div>
      <div className="chat-turn__content">
        <div className="chat-turn__label">{r}</div>
        <div className="chat-bubble">{bubble}</div>
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
  return (
    <div className={`chat-turn ${mod} ${extraClass}`.trim()}>
      <div className="chat-avatar">{av}</div>
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
  assistantHtml,
  reasoning,
  typing
}: {
  assistantHtml: string;
  reasoning: string;
  typing?: boolean;
}) {
  return (
    <div className={`chat-turn chat-turn--streaming${typing ? ' chat-turn--typing' : ''}`}>
      <div className="chat-avatar">AI</div>
      <div className="chat-turn__content">
        <div className="chat-turn__label">assistant (streaming)</div>
        <div className="chat-bubble">
          {reasoning ? (
            <pre className="chat-bubble__thinking">{reasoning}</pre>
          ) : null}
          <div
            className="chat-bubble__body chat-bubble__md"
            dangerouslySetInnerHTML={{ __html: assistantHtml }}
          />
        </div>
      </div>
    </div>
  );
}
