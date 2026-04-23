'use client';

import type { ReactNode } from 'react';
import { useLayoutEffect } from 'react';
import { api } from '@/lib/api';
import { messageHasStructuredParts, msgPartsToText, normalizedRole } from '@/lib/chat-utils';
import type { AgentInfo, ChatMessage, SessionSummary } from '@/lib/types';
import { ChatTurnFromMessage, ChatTurnPlain, ChatTurnStreaming } from './ChatTurns';
import { SurfaceContextProvider } from './a2ui/SurfaceContext';
import type { usePlayChat } from './usePlayChat';

import { groupAgentsByDomain, sortAgentsById } from '@/lib/sort-utils';

export interface PlayPanelProps {
  active: boolean;
  sessions: SessionSummary[];
  agents: AgentInfo[];
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onRunSession: () => void;
  onCancelSession: () => void;
  chat: ReturnType<typeof usePlayChat>;
}

export function PlayPanel({
  active,
  sessions,
  agents,
  selectedSessionId,
  onSelectSession,
  onNewSession,
  onRunSession,
  onCancelSession,
  chat,
}: PlayPanelProps) {
  const agentsByDomain = groupAgentsByDomain(agents);
  const flatAgents = sortAgentsById(agents); // kept for keyboard fallback / a11y

  // Auto-resize textarea
  useLayoutEffect(() => {
    const el = chat.playInputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [chat.playInput, chat.playInputRef]);

  const renderPlayMessages = (): ReactNode => {
    if (!selectedSessionId && !chat.optimisticUser && chat.sessionMessages.length === 0 && !chat.streamOverlay && !chat.waitTyping) {
      return (
        <div className="chat-empty">
          <h3 className="chat-empty__title">选择或创建会话</h3>
          <p className="chat-empty__hint">从左侧选择会话，或在下方输入首条消息以新建</p>
        </div>
      );
    }
    if (selectedSessionId && chat.sessionMessages.length === 0 && !chat.optimisticUser && !chat.streamOverlay && !chat.waitTyping) {
      return (
        <div className="chat-empty">
          <h3 className="chat-empty__title">暂无消息</h3>
          <p className="chat-empty__hint">发送一条消息开始对话</p>
        </div>
      );
    }

    const nodes: ReactNode[] = [];
    let k = 0;
    const sid = selectedSessionId ?? '';
    for (let mi = 0; mi < chat.sessionMessages.length; mi += 1) {
      const m = chat.sessionMessages[mi]!;
      if (messageHasStructuredParts(m.parts)) {
        nodes.push(<ChatTurnFromMessage key={`m${k++}`} m={m} sessionId={sid} msgIndex={mi} />);
      } else {
        const r = normalizedRole(m);
        const plain = msgPartsToText(m.parts);
        if (r === 'tool' || r === 'system') {
          nodes.push(<ChatTurnPlain key={`m${k++}`} role={r} text={plain} />);
        } else {
          nodes.push(<ChatTurnFromMessage key={`m${k++}`} m={m} sessionId={sid} msgIndex={mi} />);
        }
      }
    }
    if (chat.optimisticUser) {
      nodes.push(<ChatTurnPlain key="opt-user" role="user" text={chat.optimisticUser} />);
    }
    if (chat.streamOverlay) {
      nodes.push(
        <ChatTurnStreaming key="stream" segments={chat.streamOverlay.segments} sessionId={sid} />
      );
    }
    if (chat.waitTyping) {
      nodes.push(<ChatTurnPlain key="wait" role="assistant" text="…" extraClass="chat-turn--typing" />);
    }
    return <>{nodes}</>;
  };

  return (
    <section className={`panel ${active ? 'active' : ''}`} id="panel-play" role="tabpanel">
      <div className="play-layout">
        <aside className="play-sidebar card card-elevated">
          <h3 className="card-title">会话</h3>
          <button type="button" className="btn btn-secondary btn-block" onClick={onNewSession}>
            新建（清空选择）
          </button>
          <div className="list-scroll" id="sessionListMini">
            {!sessions.length ? (
              <div className="empty-hint">无会话</div>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.id}
                  className={`list-item ${selectedSessionId === s.id ? 'selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectSession(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onSelectSession(s.id);
                  }}
                >
                  <div className="row">
                    <strong>{s.title}</strong>
                    <span className="pill">{s.mode}</span>
                    <span className={`pill ${s.status === 'waiting_approval' ? 'pill-warn' : s.status === 'completed' ? 'pill-ok' : ''}`}>
                      {s.status}
                    </span>
                  </div>
                  <div className="row muted" style={{ fontSize: '0.75rem' }}>
                    {s.id.slice(0, 12)}…
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="divider" />
          <label className="field">
            <span>模式</span>
            <select value={chat.mode} onChange={(e) => chat.setMode(e.target.value as 'chat' | 'task')}>
              <option value="chat">Chat</option>
              <option value="task">Task</option>
            </select>
          </label>
          <label className="field">
            <span>Agent</span>
            <select id="agentSelect" value={chat.agentId} onChange={(e) => chat.setAgentId(e.target.value)}>
              {agentsByDomain.length <= 1
                ? flatAgents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.id} · {a.role}
                    </option>
                  ))
                : agentsByDomain.map(({ domainId, agents: bucket }) => (
                    <optgroup key={domainId} label={domainId.toUpperCase()}>
                      {bucket.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.id} · {a.role}
                        </option>
                      ))}
                    </optgroup>
                  ))}
            </select>
          </label>
          <label className="toggle field-toggle">
            <input type="checkbox" checked={chat.useStream} onChange={(e) => chat.setUseStream(e.target.checked)} />
            <span>流式输出 (SSE)</span>
          </label>
          {chat.optionalToolGroupsFeature && chat.optionalToolCatalog.length > 0 ? (
            <div className="field" style={{ marginTop: '0.5rem' }}>
              <span>可选工具组</span>
              <div className="optional-tool-groups" style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {chat.optionalToolCatalog.map((g) => (
                  <label key={g.id} className="toggle" style={{ alignItems: 'flex-start' }}>
                    <input
                      type="checkbox"
                      checked={chat.enabledOptionalGroupIds.includes(g.id)}
                      onChange={(e) => void chat.toggleOptionalGroup(g.id, e.target.checked)}
                    />
                    <span>
                      <strong>{g.title}</strong>
                      {g.description ? <span className="muted"> — {g.description}</span> : null}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
        </aside>
        <div className="play-main card card-elevated chat-panel">
          <header className="chat-panel-header">
            <div className="chat-panel-header__text">
              <span className="agent-kicker" aria-hidden="true">
                Playground · Session
              </span>
              <h2 className="chat-panel-title" id="playTitle">
                {chat.playTitle}
              </h2>
              <p className="chat-panel-meta muted" id="playMeta">
                {chat.playMeta}
              </p>
            </div>
            <div className="chat-panel-header__actions play-toolbar">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                id="btnRunSession"
                disabled={!selectedSessionId}
                onClick={onRunSession}
              >
                Run
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                id="btnCancelSession"
                disabled={!selectedSessionId}
                onClick={onCancelSession}
              >
                停止
              </button>
            </div>
          </header>
          <div className="chat-panel-body">
            <div className="chat-feed" id="playMessages" ref={chat.playMessagesRef} role="log" aria-live="polite" aria-relevant="additions">
              <SurfaceContextProvider messages={chat.sessionMessages}>
                {renderPlayMessages()}
              </SurfaceContextProvider>
            </div>
            <div className="chat-composer-outer">
              <label className="sr-only" htmlFor="playInput">
                消息内容
              </label>
              <div className="chat-composer">
                <textarea
                  ref={chat.playInputRef}
                  id="playInput"
                  className="chat-composer-input"
                  rows={1}
                  placeholder="发消息给 Agent…"
                  autoComplete="off"
                  value={chat.playInput}
                  onChange={(e) => chat.setPlayInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (chat.playSending) return;
                      void chat.sendPlayMessage();
                    }
                  }}
                />
                <button
                  type="button"
                  className="chat-send-btn"
                  id="btnSend"
                  aria-label="发送"
                  disabled={chat.playSending}
                  onClick={() => void chat.sendPlayMessage()}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M3.478 2.404a.75.75 0 0 0-.476.784l1.3 7.547a.75.75 0 0 0 .75.615h4.138a.25.25 0 0 1 .158.444l-3.25 2.5a.75.75 0 0 0-.116 1.14l5.9 5.9a.75.75 0 0 0 1.28-.53V4.302a.75.75 0 0 0-1.084-.672l-9.036 3.774z" />
                  </svg>
                </button>
              </div>
              <div className="chat-composer-media">
                <input
                  type="file"
                  id="playImageFile"
                  className="sr-only"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    const files = e.target.files;
                    if (!files?.length) return;
                    void chat.handleFileUpload(files);
                    e.target.value = '';
                  }}
                />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => document.getElementById('playImageFile')?.click()}>
                  本地图片
                </button>
                <input
                  type="url"
                  id="playImageUrl"
                  className="chat-image-url"
                  placeholder="图片 URL（服务端下载）"
                  autoComplete="off"
                  value={chat.imageUrlInput}
                  onChange={(e) => chat.setImageUrlInput(e.target.value)}
                />
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void chat.handleUrlFetch()}>
                  拉取
                </button>
              </div>
              <div id="pendingImages" className="pending-images" aria-label="待发送图片">
                {chat.pendingImageAssetIds.map((id) => (
                  <span key={id} className="pending-img-row">
                    <span className="chip chip-muted" title={id}>
                      {id.slice(0, 14)}…
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => chat.setPendingImageAssetIds((x) => x.filter((y) => y !== id))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <p
                id="playStatus"
                className={`chat-composer-hint${chat.playStatus.ok ? ' ok' : ''}${chat.playStatus.err ? ' err' : ''}`}
                role="status"
              >
                {chat.playStatus.text}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
