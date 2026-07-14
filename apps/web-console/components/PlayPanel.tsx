'use client';

import type { ReactNode } from 'react';
import { useLayoutEffect, useMemo, useState } from 'react';
import type { AgentInfo, SessionSummary } from '@/lib/types';
import { messageHasStructuredParts, msgPartsToText, normalizedRole } from '@/lib/chat-utils';
import { ChatTurnFromMessage, ChatTurnPlain, ChatTurnStreaming } from './ChatTurns';
import { SurfaceContextProvider } from './a2ui/SurfaceContext';
import type { usePlayChat } from './usePlayChat';

import { groupAgentsByDomain, sortAgentsById } from '@/lib/sort-utils';
import { readSendAckSoundEnabled, writeSendAckSoundEnabled } from '@/lib/send-ack-feedback';

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
  tabs?: ReactNode;
  sessionFilter?: string;
  onSessionFilterChange?: (value: string) => void;
}

function statusDotClass(status: string): string {
  if (status === 'running') return 'status-dot status-dot--run';
  if (status === 'waiting_approval') return 'status-dot status-dot--warn';
  if (status === 'completed') return 'status-dot status-dot--ok';
  if (status === 'failed') return 'status-dot status-dot--err';
  return 'status-dot';
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
  tabs,
  sessionFilter = '',
  onSessionFilterChange,
}: PlayPanelProps) {
  const [sendAckSound, setSendAckSound] = useState(() => readSendAckSoundEnabled());
  const [attachOpen, setAttachOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const agentsByDomain = groupAgentsByDomain(agents);
  const flatAgents = sortAgentsById(agents);

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId]
  );
  const sessionBusy =
    selectedSession?.status === 'running' ||
    selectedSession?.status === 'waiting_approval' ||
    chat.playSending ||
    Boolean(chat.streamOverlay) ||
    chat.waitTyping;

  const agentLabel =
    flatAgents.find((a) => a.id === chat.agentId)?.id ?? (chat.agentId || '—');
  const configSummary = `${agentLabel} · ${chat.mode === 'task' ? 'Task' : 'Chat'}${chat.useStream ? ' · Stream' : ''}`;

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
          <p className="chat-empty__hint">从左侧选择会话，或新建后开始对话</p>
          <button type="button" className="btn btn-primary btn-sm chat-empty__cta" onClick={onNewSession}>
            新建会话
          </button>
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
        <aside className="play-sidebar">
          <div className="play-sidebar__head">
            <h3 className="play-sidebar__title">会话</h3>
            <button
              type="button"
              className="btn btn-primary btn-icon"
              onClick={onNewSession}
              aria-label="新建会话"
              title="新建会话"
            >
              +
            </button>
          </div>
          {onSessionFilterChange ? (
            <label className="play-sidebar__search">
              <span className="sr-only">筛选会话</span>
              <input
                type="search"
                className="input-compact"
                placeholder="筛选…"
                autoComplete="off"
                value={sessionFilter}
                onChange={(e) => onSessionFilterChange(e.target.value)}
                aria-label="筛选会话列表"
              />
            </label>
          ) : null}
          <div className="list-scroll play-sidebar__list" id="sessionListMini">
            {!sessions.length ? (
              <div className="empty-hint">无会话</div>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.id}
                  className={`list-item list-item--session ${selectedSessionId === s.id ? 'selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectSession(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onSelectSession(s.id);
                  }}
                >
                  <div className="session-item__title">{s.title || '未命名'}</div>
                  <div className="session-item__meta">
                    <span className={statusDotClass(s.status)} aria-hidden="true" />
                    <span>
                      {s.agentId || '—'} · {s.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        <div className="play-main-col">
          {tabs}
          <div className="play-main chat-panel">
            <header className="chat-panel-header">
              <div className="chat-panel-header__text">
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
                  className={`btn btn-sm ${sessionBusy ? 'btn-ghost' : 'btn-secondary'}`}
                  id={sessionBusy ? 'btnCancelSession' : 'btnRunSession'}
                  disabled={!selectedSessionId}
                  onClick={() => {
                    if (sessionBusy) onCancelSession();
                    else onRunSession();
                  }}
                >
                  {sessionBusy ? '停止' : 'Run'}
                </button>
              </div>
            </header>
            <div className="chat-panel-body">
              <div
                className="chat-feed"
                id="playMessages"
                ref={chat.playMessagesRef}
                role="log"
                aria-live="polite"
                aria-relevant="additions"
              >
                <div className="chat-feed__track">
                  <SurfaceContextProvider messages={chat.sessionMessages}>
                    {renderPlayMessages()}
                  </SurfaceContextProvider>
                </div>
              </div>
              <div className="chat-composer-outer">
                <label className="sr-only" htmlFor="playInput">
                  消息内容
                </label>
                <div className={`chat-composer${chat.composerAckFlash ? ' chat-composer--ack-flash' : ''}`}>
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
                  {chat.speechDictationAvailable ? (
                    <button
                      type="button"
                      className={`chat-mic-btn${chat.speechDictating ? ' chat-mic-btn--active' : ''}`}
                      id="btnSpeechDictation"
                      aria-label={chat.speechDictating ? '停止语音听写' : '语音听写'}
                      aria-pressed={chat.speechDictating}
                      disabled={chat.playSending}
                      title="语音听写（浏览器 Web Speech）"
                      onClick={() => chat.toggleSpeechDictation()}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 1 1-10 0H5a7 7 0 0 0 6 6.92V20H9v2h6v-2h-2v-2.08A7 7 0 0 0 19 11h-2z" />
                      </svg>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="chat-send-btn"
                    id="btnSend"
                    aria-label="发送"
                    disabled={chat.playSending}
                    onClick={() => void chat.sendPlayMessage()}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M3.478 2.404a.75.75 0 0 0-.476.784l1.3 7.547a.75.75 0 0 0 .75.615h4.138a.25.25 0 0 1 .158.444l-3.25 2.5a.75.75 0 0 0-.116 1.14l5.9 5.9a.75.75 0 0 0 1.28-.53V4.302a.75.75 0 0 0-1.084-.672l-9.036 3.774z" />
                    </svg>
                  </button>
                </div>

                <div className="chat-composer-dock">
                  <div className="chat-composer-dock__left">
                    <button
                      type="button"
                      className={`btn btn-ghost btn-icon btn-sm${attachOpen ? ' is-open' : ''}`}
                      aria-expanded={attachOpen}
                      aria-controls="composerAttachPanel"
                      title="附件"
                      onClick={() => setAttachOpen((v) => !v)}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className="composer-config-summary"
                      aria-expanded={configOpen}
                      aria-controls="composerConfigPanel"
                      onClick={() => setConfigOpen((v) => !v)}
                    >
                      {configSummary}
                    </button>
                  </div>
                  <p
                    id="playStatus"
                    className={`chat-composer-hint${chat.playStatus.ok ? ' ok' : ''}${chat.playStatus.err ? ' err' : ''}`}
                    role="status"
                  >
                    {chat.playStatus.text}
                  </p>
                </div>

                {attachOpen ? (
                  <div id="composerAttachPanel" className="composer-attach-panel">
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
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => document.getElementById('playImageFile')?.click()}
                    >
                      本地图片
                    </button>
                    <input
                      type="url"
                      id="playImageUrl"
                      className="chat-image-url"
                      placeholder="图片 URL"
                      autoComplete="off"
                      value={chat.imageUrlInput}
                      onChange={(e) => chat.setImageUrlInput(e.target.value)}
                    />
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void chat.handleUrlFetch()}>
                      拉取
                    </button>
                  </div>
                ) : null}

                {configOpen ? (
                  <div id="composerConfigPanel" className="composer-config-panel">
                    <label className="field field--inline">
                      <span>模式</span>
                      <select value={chat.mode} onChange={(e) => chat.setMode(e.target.value as 'chat' | 'task')}>
                        <option value="chat">Chat</option>
                        <option value="task">Task</option>
                      </select>
                    </label>
                    <label className="field field--inline">
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
                      <input
                        type="checkbox"
                        checked={chat.useStream}
                        onChange={(e) => chat.setUseStream(e.target.checked)}
                      />
                      <span>流式输出</span>
                    </label>
                    <label className="toggle field-toggle">
                      <input
                        type="checkbox"
                        checked={sendAckSound}
                        onChange={(e) => {
                          const on = e.target.checked;
                          setSendAckSound(on);
                          writeSendAckSoundEnabled(on);
                        }}
                      />
                      <span>发送确认音</span>
                    </label>
                    {chat.optionalToolGroupsFeature && chat.optionalToolCatalog.length > 0 ? (
                      <div className="optional-tool-groups">
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
                    ) : null}
                  </div>
                ) : null}

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
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
