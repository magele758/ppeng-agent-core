'use client';

import type { ReactNode } from 'react';
import { useLayoutEffect, useMemo, useState } from 'react';
import type { AgentInfo, ApprovalItem, SessionSummary } from '@/lib/types';
import { collectActivityTools, collectArtifacts } from '@/lib/activity-tools';
import {
  autonomyLabel,
  formatCostUsd,
  latestGoalMet,
  type AutonomyLevel
} from '@/lib/session-chrome';
import { messageHasStructuredParts, msgPartsToText, normalizedRole } from '@/lib/chat-utils';
import { ChatTurnFromMessage, ChatTurnPlain, ChatTurnStreaming } from './ChatTurns';
import { SurfaceContextProvider } from './a2ui/SurfaceContext';
import type { usePlayChat } from './usePlayChat';
import { ActivityPanel } from './ActivityPanel';
import { ArtifactRail } from './ArtifactRail';
import { ApprovalBanner } from './ApprovalBanner';

import { groupAgentsByDomain, sortAgentsById } from '@/lib/sort-utils';
import { readSendAckSoundEnabled, writeSendAckSoundEnabled } from '@/lib/send-ack-feedback';
import { AgentLoopSettingsCard } from './AgentLoopSettingsCard';
import { CompactSettingsCard } from './CompactSettingsCard';

export interface PlayPanelProps {
  active: boolean;
  sessions: SessionSummary[];
  agents: AgentInfo[];
  approvals: ApprovalItem[];
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onRunSession: () => void;
  onCancelSession: () => void;
  onOpenTrace: () => void;
  onApprovalsChanged: () => void;
  chat: ReturnType<typeof usePlayChat>;
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
  approvals,
  selectedSessionId,
  onSelectSession,
  onNewSession,
  onRunSession,
  onCancelSession,
  onOpenTrace,
  onApprovalsChanged,
  chat,
  sessionFilter = '',
  onSessionFilterChange
}: PlayPanelProps) {
  const [sendAckSound, setSendAckSound] = useState(() => readSendAckSoundEnabled());
  const [attachOpen, setAttachOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [stopMenuOpen, setStopMenuOpen] = useState(false);
  const [railTab, setRailTab] = useState<'activity' | 'artifacts'>('activity');
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

  const sessionApprovals = useMemo(
    () =>
      approvals.filter(
        (a) => a.sessionId === selectedSessionId && (!a.status || a.status === 'pending')
      ),
    [approvals, selectedSessionId]
  );

  const activityItems = useMemo(
    () => collectActivityTools(chat.sessionMessages, chat.streamOverlay?.segments),
    [chat.sessionMessages, chat.streamOverlay]
  );
  const artifacts = useMemo(
    () =>
      collectArtifacts(chat.sessionMessages, chat.streamOverlay?.segments, chat.pendingImageAssetIds),
    [chat.sessionMessages, chat.streamOverlay, chat.pendingImageAssetIds]
  );

  const chrome = chat.sessionChrome;
  const goalMet = chrome ? latestGoalMet(chrome) : null;
  const tokens =
    chrome?.usageTotals?.totalTokens ??
    (chrome?.usageTotals
      ? (chrome.usageTotals.inputTokens ?? 0) + (chrome.usageTotals.outputTokens ?? 0)
      : undefined);

  const agentLabel =
    flatAgents.find((a) => a.id === chat.agentId)?.id ?? (chat.agentId || '—');
  const modelLabel = chat.modelRef?.modelId ?? 'heuristic';
  const configSummary = `${agentLabel} · ${modelLabel} · ${chat.mode === 'task' ? 'Task' : 'Chat'}${chat.useStream ? ' · Stream' : ''}`;

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
      <div className="play-layout play-layout--rail">
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
          <div className="play-main chat-panel">
            <header className="chat-panel-header">
              <div className="chat-panel-header__text">
                <h2 className="chat-panel-title" id="playTitle">
                  {chat.playTitle}
                </h2>
                <div className="session-chrome" id="playMeta">
                  <span className="session-chrome__chip">
                    <span className={statusDotClass(chrome?.status ?? selectedSession?.status ?? '')} />
                    {chrome?.status ?? selectedSession?.status ?? '—'}
                  </span>
                  <span className="session-chrome__chip" title="自主度 / permissionMode">
                    {autonomyLabel(chat.autonomyLevel)}
                  </span>
                  <span className="session-chrome__chip" title="累计成本估算">
                    {formatCostUsd(chrome?.usageCostUsd)}
                    {tokens != null ? ` · ${tokens} tok` : ''}
                  </span>
                  <span
                    className={`session-chrome__chip${goalMet === true ? ' is-ok' : goalMet === false ? ' is-warn' : ''}`}
                    title={chrome?.goalCondition || '未设置目标'}
                  >
                    goal {goalMet === true ? 'met' : chrome?.goalEnabled ? 'open' : 'off'}
                    {chrome?.goalTurnsUsed != null
                      ? ` ${chrome.goalTurnsUsed}${chrome.goalMaxTurns != null ? `/${chrome.goalMaxTurns}` : ''}`
                      : ''}
                  </span>
                </div>
              </div>
              <div className="chat-panel-header__actions play-toolbar">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={!selectedSessionId}
                  onClick={onOpenTrace}
                  title="查看本会话 Trace"
                >
                  Trace
                </button>
                {sessionBusy ? (
                  <div className="stop-menu">
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      id="btnCancelSession"
                      disabled={!selectedSessionId}
                      aria-expanded={stopMenuOpen}
                      onClick={() => setStopMenuOpen((v) => !v)}
                    >
                      停止 ▾
                    </button>
                    {stopMenuOpen ? (
                      <div className="stop-menu__pop" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          className="stop-menu__item"
                          onClick={() => {
                            setStopMenuOpen(false);
                            onCancelSession();
                          }}
                        >
                          停止本轮
                          <span className="muted small">取消当前会话运行</span>
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="stop-menu__item"
                          title="当前运行时无单独「停工具」API，与停止本轮相同"
                          onClick={() => {
                            setStopMenuOpen(false);
                            onCancelSession();
                          }}
                        >
                          停止当前工具
                          <span className="muted small">暂与停止本轮相同（cancel session）</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    id="btnRunSession"
                    disabled={!selectedSessionId}
                    onClick={onRunSession}
                  >
                    Run
                  </button>
                )}
              </div>
            </header>

            <ApprovalBanner approvals={sessionApprovals} onDone={onApprovalsChanged} />

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
                <div className="goal-autonomy-bar">
                  <label className="goal-autonomy-bar__goal">
                    <span className="sr-only">目标条件</span>
                    <input
                      type="text"
                      className="input-compact"
                      placeholder="Goal / 验收条件（可选）"
                      disabled={!selectedSessionId}
                      value={chat.goalDraft}
                      onChange={(e) => chat.setGoalDraft(e.target.value)}
                      onBlur={() => {
                        if (!selectedSessionId) return;
                        const next = chat.goalDraft.trim();
                        const prev = (chrome?.goalCondition ?? '').trim();
                        if (next !== prev) void chat.saveGoalCondition(next);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void chat.saveGoalCondition(chat.goalDraft);
                        }
                      }}
                    />
                  </label>
                  <label className="goal-autonomy-bar__autonomy">
                    <span className="sr-only">自主度</span>
                    <select
                      disabled={!selectedSessionId}
                      value={chat.autonomyLevel}
                      onChange={(e) => void chat.saveAutonomy(e.target.value as AutonomyLevel)}
                      aria-label="自主度"
                    >
                      <option value="supervised">{autonomyLabel('supervised')}</option>
                      <option value="balanced">{autonomyLabel('balanced')}</option>
                      <option value="autonomous">{autonomyLabel('autonomous')}</option>
                    </select>
                  </label>
                </div>

                <label className="sr-only" htmlFor="playInput">
                  消息内容
                </label>
                <div className={`chat-composer${chat.composerAckFlash ? ' chat-composer--ack-flash' : ''}`}>
                  <textarea
                    ref={chat.playInputRef}
                    id="playInput"
                    className="chat-composer-input"
                    rows={1}
                    placeholder={
                      chat.playSending || Boolean(chat.streamOverlay) || chat.waitTyping
                        ? '进行中：插入一句到下一枪…'
                        : '发消息给 Agent…'
                    }
                    autoComplete="off"
                    value={chat.playInput}
                    onChange={(e) => chat.setPlayInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
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
                    aria-label={
                      chat.playSending || Boolean(chat.streamOverlay) || chat.waitTyping ? '插入下一枪' : '发送'
                    }
                    disabled={
                      chat.playSending || Boolean(chat.streamOverlay) || chat.waitTyping
                        ? chat.playInput.trim().length === 0
                        : false
                    }
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
                    <label className="sr-only" htmlFor="playModelSelect">
                      模型
                    </label>
                    <select
                      id="playModelSelect"
                      className="composer-model-select"
                      aria-label="服务商与模型"
                      value={chat.modelRef ? chat.encodeModelValue(chat.modelRef) : ''}
                      onChange={(e) => {
                        const next = chat.decodeModelValue(e.target.value);
                        if (next) void chat.saveModelRef(next);
                      }}
                    >
                      {!chat.modelOptions.length ? (
                        <option value={chat.modelRef ? chat.encodeModelValue(chat.modelRef) : 'heuristic::heuristic'}>
                          {chat.modelRef?.modelId ?? 'heuristic'}
                        </option>
                      ) : (
                        Object.entries(
                          chat.modelOptions.reduce<Record<string, typeof chat.modelOptions>>((acc, o) => {
                            const key = o.providerName;
                            (acc[key] ??= []).push(o);
                            return acc;
                          }, {})
                        ).map(([group, opts]) => (
                          <optgroup key={group} label={group}>
                            {opts.map((o) => (
                              <option key={`${o.providerId}::${o.modelId}`} value={`${o.providerId}::${o.modelId}`}>
                                {o.modelId}
                              </option>
                            ))}
                          </optgroup>
                        ))
                      )}
                    </select>
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
                    <AgentLoopSettingsCard compact />
                    <CompactSettingsCard compact />
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

        <aside className="play-rail">
          <div className="play-rail__tabs" role="tablist" aria-label="右侧栏">
            <button
              type="button"
              role="tab"
              className={`play-rail__tab${railTab === 'activity' ? ' active' : ''}`}
              aria-selected={railTab === 'activity'}
              onClick={() => setRailTab('activity')}
            >
              Activity
            </button>
            <button
              type="button"
              role="tab"
              className={`play-rail__tab${railTab === 'artifacts' ? ' active' : ''}`}
              aria-selected={railTab === 'artifacts'}
              onClick={() => setRailTab('artifacts')}
            >
              Artifacts
            </button>
          </div>
          <div className="play-rail__body">
            {railTab === 'activity' ? (
              <ActivityPanel items={activityItems} />
            ) : (
              <ArtifactRail items={artifacts} />
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
