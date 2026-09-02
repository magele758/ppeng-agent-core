'use client';

import { api } from '@/lib/api';
import { getSpeechRecognitionCtor, type SpeechRecognitionLike } from '@/lib/speech-dictation';
import { renderMarkdown } from '@/lib/markdown';
import type { StreamSegment } from '@/lib/stream-segments';
import { feedSseBuffer } from '@/lib/sse';
import { userPreviewText } from '@/lib/chat-utils';
import { playSendAckToneIfEnabled } from '@/lib/send-ack-feedback';
import {
  parseSessionChrome,
  type AutonomyLevel,
  type SessionChromeMeta,
  autonomyToPermission,
  permissionToAutonomy
} from '@/lib/session-chrome';
import {
  catalogNeedsSetup,
  decodeModelValue,
  encodeModelValue,
  parseSessionModelRef,
  type ModelPickerOption,
  type ModelRef,
  type ModelProvidersResponse
} from '@/lib/model-providers';
import type { AgentInfo, ChatMessage } from '@/lib/types';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export type CompactPolicy = 'keep_recent' | 'after_any_assistant' | 'after_text_assistant';

export type SessionModelViewPayload = {
  stored: ChatMessage[];
  modelView: ChatMessage[];
  stats: { collapsed: number; trimmed: number; charsSaved: number };
  policy: CompactPolicy;
};

export type OptionalToolCatalogGroup = {
  id: string;
  title: string;
  description?: string;
  items: Array<{ id: string; title: string; description?: string; tool_names: string[] }>;
};

function optionalGroupsBody(feature: boolean, ids: string[]): { enabledOptionalToolGroups?: string[] } {
  if (!feature) return {};
  return { enabledOptionalToolGroups: ids };
}

function modelRefBody(ref: ModelRef | null): { modelRef?: ModelRef } {
  if (!ref) return {};
  return { modelRef: ref };
}

const SCROLL_BOTTOM_EPS = 72;

function isNearBottom(el: HTMLElement | null) {
  if (!el) return true;
  const { scrollTop, scrollHeight, clientHeight } = el;
  if (scrollHeight <= clientHeight) return true;
  return scrollHeight - scrollTop - clientHeight <= SCROLL_BOTTOM_EPS;
}

function scrollElToBottom(el: HTMLElement) {
  const top = Math.max(0, el.scrollHeight - el.clientHeight);
  el.scrollTo({ top, behavior: 'auto' });
}

function fileToBase64Data(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result || '');
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export interface PlayChatDeps {
  selectedSessionId: string | null;
  setSelectedSessionId: (id: string | null) => void;
  selectedSessionRef: React.MutableRefObject<string | null>;
  sessionListStickTopRef: React.MutableRefObject<boolean>;
  agents: AgentInfo[];
  tick: (opts?: { includePlayPanel?: boolean }) => Promise<void>;
}

export function usePlayChat(deps: PlayChatDeps) {
  const {
    selectedSessionId,
    setSelectedSessionId,
    selectedSessionRef,
    sessionListStickTopRef,
    agents,
    tick,
  } = deps;

  const [sessionMessages, setSessionMessages] = useState<ChatMessage[]>([]);
  const [playTitle, setPlayTitle] = useState('选择或创建会话');
  const [playMeta, setPlayMeta] = useState('');
  const [sessionChrome, setSessionChrome] = useState<SessionChromeMeta | null>(null);
  const [goalDraft, setGoalDraft] = useState('');
  const [playInput, setPlayInput] = useState('');
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [pendingImageAssetIds, setPendingImageAssetIds] = useState<string[]>([]);
  const [playStatus, setPlayStatus] = useState<{ text: string; ok?: boolean; err?: boolean }>({ text: '' });
  const [optimisticUser, setOptimisticUser] = useState<string | null>(null);
  const [streamOverlay, setStreamOverlay] = useState<{ segments: StreamSegment[] } | null>(null);
  const [waitTyping, setWaitTyping] = useState(false);
  const [playSending, setPlaySending] = useState(false);
  const [composerAckFlash, setComposerAckFlash] = useState(false);
  const [mode, setMode] = useState<'chat' | 'task'>('chat');
  const [agentId, setAgentId] = useState('');
  const [modelOptions, setModelOptions] = useState<ModelPickerOption[]>([]);
  const [modelRef, setModelRef] = useState<ModelRef | null>(null);
  const [modelCatalog, setModelCatalog] = useState<ModelProvidersResponse | null>(null);
  const [useStream, setUseStream] = useState(true);
  const [optionalToolGroupsFeature, setOptionalToolGroupsFeature] = useState(false);
  const [optionalToolCatalog, setOptionalToolCatalog] = useState<OptionalToolCatalogGroup[]>([]);
  const [enabledOptionalGroupIds, setEnabledOptionalGroupIds] = useState<string[]>([]);
  const [speechDictationAvailable, setSpeechDictationAvailable] = useState(false);
  const [speechDictating, setSpeechDictating] = useState(false);
  const [showModelView, setShowModelView] = useState(false);
  const [modelViewPayload, setModelViewPayload] = useState<SessionModelViewPayload | null>(null);

  const playMessagesRef = useRef<HTMLDivElement>(null);
  const playInputRef = useRef<HTMLTextAreaElement>(null);
  const playInputLiveRef = useRef('');
  const speechRecRef = useRef<SpeechRecognitionLike | null>(null);
  const speechPrefixRef = useRef('');
  const speechFinalAccumRef = useRef('');
  const playStickToBottomRef = useRef(false);
  const stickFlushGenRef = useRef(0);
  const stickOuterRafRef = useRef<number | null>(null);
  const composerAckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const acknowledgeLocalSendCommitted = useCallback(() => {
    playSendAckToneIfEnabled();
    if (composerAckTimerRef.current != null) {
      clearTimeout(composerAckTimerRef.current);
    }
    setComposerAckFlash(true);
    composerAckTimerRef.current = setTimeout(() => {
      setComposerAckFlash(false);
      composerAckTimerRef.current = null;
    }, 240);
  }, []);

  const clearComposerOnly = () => {
    setPlayInput('');
    setPendingImageAssetIds([]);
  };

  const clearStreamingShell = () => {
    setOptimisticUser(null);
    setStreamOverlay(null);
    setWaitTyping(false);
  };

  const scrollPlayToBottom = () => {
    const el = playMessagesRef.current;
    if (el) scrollElToBottom(el);
  };

  const requestScrollPlayToBottom = useCallback(() => {
    playStickToBottomRef.current = true;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = (await api('/api/optional-tool-groups')) as {
          enabled?: boolean;
          catalog?: { groups?: OptionalToolCatalogGroup[] };
        };
        if (cancelled) return;
        setOptionalToolGroupsFeature(data.enabled === true);
        setOptionalToolCatalog(data.catalog?.groups ?? []);
      } catch {
        if (!cancelled) {
          setOptionalToolGroupsFeature(false);
          setOptionalToolCatalog([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyModelCatalog = useCallback((data: ModelProvidersResponse) => {
    setModelCatalog(data);
    setModelOptions(data.options ?? []);
    setModelRef((cur) => {
      const def = data.effective?.defaultRef ?? data.catalog?.defaultRef ?? null;
      if (!cur) return def;
      const still = (data.options ?? []).some(
        (o) => o.providerId === cur.providerId && o.modelId === cur.modelId
      );
      return still ? cur : def;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = (await api('/api/model-providers')) as ModelProvidersResponse;
        if (cancelled) return;
        applyModelCatalog(data);
      } catch {
        if (!cancelled) setModelOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyModelCatalog]);

  useEffect(() => {
    playInputLiveRef.current = playInput;
  }, [playInput]);

  useEffect(() => {
    setSpeechDictationAvailable(getSpeechRecognitionCtor() !== null);
  }, []);

  useEffect(() => {
    return () => {
      if (composerAckTimerRef.current != null) {
        clearTimeout(composerAckTimerRef.current);
        composerAckTimerRef.current = null;
      }
      const r = speechRecRef.current;
      speechRecRef.current = null;
      if (!r) return;
      try {
        r.onresult = null;
        r.onerror = null;
        r.onend = null;
        r.abort();
      } catch {
        try {
          r.stop();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  const stopSpeechDictation = useCallback(() => {
    const r = speechRecRef.current;
    speechRecRef.current = null;
    if (!r) {
      setSpeechDictating(false);
      return;
    }
    try {
      r.onresult = null;
      r.onerror = null;
      r.onend = null;
      r.abort();
    } catch {
      try {
        r.stop();
      } catch {
        /* ignore */
      }
    }
    setSpeechDictating(false);
  }, []);

  const toggleSpeechDictation = useCallback(() => {
    if (speechRecRef.current) {
      stopSpeechDictation();
      return;
    }
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setPlayStatus({ text: '当前浏览器不支持语音听写', err: true });
      return;
    }
    speechPrefixRef.current = playInputLiveRef.current;
    speechFinalAccumRef.current = '';
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang =
      typeof navigator !== 'undefined' && navigator.language && navigator.language.length > 0
        ? navigator.language
        : 'zh-CN';
    rec.onresult = (ev) => {
      let interim = '';
      let deltaFinal = '';
      for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
        const res = ev.results[i];
        if (!res?.[0]) continue;
        const t = res[0].transcript;
        if (res.isFinal) deltaFinal += t;
        else interim += t;
      }
      speechFinalAccumRef.current += deltaFinal;
      setPlayInput(speechPrefixRef.current + speechFinalAccumRef.current + interim);
    };
    rec.onerror = (ev) => {
      if (ev.error === 'aborted' || ev.error === 'no-speech') return;
      setPlayStatus({ text: `语音听写: ${ev.error}`, err: true });
      stopSpeechDictation();
    };
    rec.onend = () => {
      if (speechRecRef.current !== rec) return;
      speechRecRef.current = null;
      setSpeechDictating(false);
    };
    try {
      rec.start();
      speechRecRef.current = rec;
      setSpeechDictating(true);
      setPlayStatus({ text: '正在听取…再次点击麦克风结束', ok: true });
    } catch (e) {
      setPlayStatus({ text: e instanceof Error ? e.message : '无法启动语音识别', err: true });
    }
  }, [stopSpeechDictation]);

  const toggleOptionalGroup = useCallback(
    async (groupId: string, on: boolean) => {
      const next = on
        ? [...new Set([...enabledOptionalGroupIds, groupId])]
        : enabledOptionalGroupIds.filter((id) => id !== groupId);
      setEnabledOptionalGroupIds(next);
      const sid = selectedSessionRef.current;
      if (sid && optionalToolGroupsFeature) {
        try {
          await api(`/api/sessions/${encodeURIComponent(sid)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabledOptionalToolGroups: next }),
          });
          await tick();
        } catch {
          setEnabledOptionalGroupIds(enabledOptionalGroupIds);
        }
      }
    },
    [enabledOptionalGroupIds, optionalToolGroupsFeature, selectedSessionRef, tick]
  );

  const saveModelRef = useCallback(
    async (next: ModelRef) => {
      setModelRef(next);
      const sid = selectedSessionRef.current;
      try {
        if (sid) {
          await api(`/api/sessions/${encodeURIComponent(sid)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ modelRef: next })
          });
        }
        await api('/api/model-providers/default', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ defaultRef: next })
        });
      } catch (e) {
        setPlayStatus({ text: e instanceof Error ? e.message : String(e), err: true });
      }
    },
    [selectedSessionRef]
  );

  const refreshPlayPanel = useCallback(async () => {
    const sid = selectedSessionRef.current;
    if (!sid) {
      setPlayTitle('选择或创建会话');
      setPlayMeta('');
      setSessionChrome(null);
      setGoalDraft('');
      setSessionMessages([]);
      setEnabledOptionalGroupIds([]);
      setModelViewPayload(null);
      return;
    }
    try {
      const data = (await api(`/api/sessions/${sid}`)) as {
        session: {
          title: string;
          mode: string;
          status: string;
          agentId: string;
          metadata?: Record<string, unknown>;
        };
        messages: ChatMessage[];
      };
      const chrome = parseSessionChrome(data.session.metadata, data.session.status);
      setPlayTitle(data.session.title || sid.slice(0, 12));
      setPlayMeta(`${data.session.mode} · ${data.session.status} · agent=${data.session.agentId}`);
      setSessionChrome(chrome);
      setGoalDraft(chrome.goalCondition ?? '');
      setSessionMessages(data.messages ?? []);
      const eg = data.session.metadata?.enabledOptionalToolGroups;
      setEnabledOptionalGroupIds(Array.isArray(eg) ? eg.map(String) : []);
      const fromSession = parseSessionModelRef(data.session.metadata);
      if (fromSession) setModelRef(fromSession);
      try {
        const view = (await api(`/api/sessions/${sid}/model-view`)) as SessionModelViewPayload;
        setModelViewPayload(view);
      } catch {
        setModelViewPayload(null);
      }
    } catch {
      setPlayTitle('加载失败');
      setPlayMeta('');
      setSessionChrome(null);
      setSessionMessages([]);
      setEnabledOptionalGroupIds([]);
      setModelViewPayload(null);
    }
  }, [selectedSessionRef]);

  const saveGoalCondition = useCallback(
    async (condition: string) => {
      const sid = selectedSessionRef.current;
      if (!sid) return;
      const cond = condition.trim();
      await api(`/api/sessions/${sid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          cond
            ? { goalCondition: cond, goalEnabled: true }
            : { goalCondition: '', goalEnabled: false }
        )
      });
      await refreshPlayPanel();
    },
    [selectedSessionRef, refreshPlayPanel]
  );

  const saveAutonomy = useCallback(
    async (level: AutonomyLevel) => {
      const sid = selectedSessionRef.current;
      if (!sid) return;
      await api(`/api/sessions/${sid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissionMode: autonomyToPermission(level) })
      });
      await refreshPlayPanel();
    },
    [selectedSessionRef, refreshPlayPanel]
  );

  /**
   * E11: read an SSE stream with bounded retry on transport failure.
   *
   * SSE itself is built for browser auto-reconnect via EventSource, but we use
   * `fetch` (POST body required) which closes on network drop without notice.
   * We retry the POST up to 3 times with 1s / 3s / 10s backoff so a daemon
   * restart or transient blip doesn't strand the chat panel mid-stream.
   *
   * Caveats:
   *   - Only the *initial* request is retried. Once the stream starts emitting,
   *     a mid-stream disconnect raises and shows the user — auto-replaying
   *     would risk double-billing the model.
   *   - Aborted-by-user (composer cleared etc.) is NOT retried.
   */
  const RECONNECT_DELAYS_MS = [1000, 3000, 10000];

  const readSseFetch = async (url: string, body: unknown, onSession?: (id: string) => void) => {
    let res: Response | undefined;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= RECONNECT_DELAYS_MS.length; attempt++) {
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) break;
        // 4xx client errors (except 408/425 which are transient) are terminal:
        // validation failures, rate-limits (429 with Retry-After), auth errors, etc.
        // Surfacing immediately avoids the 14-second blind retry loop.
        if (res.status < 500 && res.status !== 408 && res.status !== 425) {
          // Throw OUTSIDE the try-catch so the loop exits immediately.
          lastErr = new Error(`SSE handshake failed: HTTP ${res.status}`);
          break;
        }
        lastErr = new Error(`SSE handshake HTTP ${res.status}`);
      } catch (err) {
        lastErr = err;
      }
      if (attempt < RECONNECT_DELAYS_MS.length) {
        await new Promise((r) => setTimeout(r, RECONNECT_DELAYS_MS[attempt]));
      }
    }
    if (!res || !res.ok) {
      throw lastErr ?? new Error('SSE connection failed');
    }
    const segments: StreamSegment[] = [];
    let idCounter = 0;
    const nextId = () => `s-${++idCounter}`;

    const sync = () => {
      setStreamOverlay({ segments: [...segments] });
    };

    const reader = res.body?.getReader();
    if (!reader) return;
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf = feedSseBuffer(buf, value, dec, (event, payload) => {
        const p = payload as {
          type?: string;
          text?: string;
          toolCallId?: string;
          name?: string;
          argumentsFragment?: string;
          surfaceId?: string;
          envelope?: Record<string, unknown>;
          session?: { id: string };
        };
        if (event === 'model' && p.type === 'text_delta') {
          const delta = p.text ?? '';
          const last = segments[segments.length - 1];
          if (last?.kind === 'text') {
            last.raw += delta;
            last.html = renderMarkdown(last.raw || '…');
          } else {
            segments.push({ kind: 'text', id: nextId(), raw: delta, html: renderMarkdown(delta || '…') });
          }
          sync();
        }
        if (event === 'model' && p.type === 'reasoning_delta') {
          const delta = p.text ?? '';
          const last = segments[segments.length - 1];
          if (last?.kind === 'reasoning') {
            last.text += delta;
          } else {
            segments.push({ kind: 'reasoning', id: nextId(), text: delta });
          }
          sync();
        }
        if (event === 'model' && p.type === 'tool_call_start') {
          const toolCallId = p.toolCallId ?? nextId();
          segments.push({ kind: 'tool', id: nextId(), toolCallId, name: p.name ?? 'unknown', args: '' });
          sync();
        }
        if (event === 'model' && p.type === 'tool_call_delta') {
          const tcid = p.toolCallId ?? '';
          const frag = p.argumentsFragment ?? '';
          for (let i = segments.length - 1; i >= 0; i--) {
            const s = segments[i];
            if (s.kind === 'tool' && s.toolCallId === tcid) {
              s.args += frag;
              break;
            }
          }
          sync();
        }
        if (event === 'model' && p.type === 'a2ui_message' && p.surfaceId && p.envelope) {
          // Coalesce by surfaceId so the streamed surface re-renders in place.
          const existing = segments.find((s) => s.kind === 'a2ui' && s.surfaceId === p.surfaceId);
          // Catalog id is on createSurface; later envelopes carry just surfaceId.
          const csCat = (p.envelope as { createSurface?: { catalogId?: string } }).createSurface?.catalogId;
          if (existing && existing.kind === 'a2ui') {
            if (csCat) existing.catalogId = csCat;
            existing.envelopes.push(p.envelope);
          } else {
            segments.push({
              kind: 'a2ui',
              id: nextId(),
              surfaceId: p.surfaceId,
              catalogId: csCat ?? '',
              envelopes: [p.envelope]
            });
          }
          sync();
        }
        if (event === 'result' && p.session?.id) {
          const sid = p.session.id;
          onSession?.(sid);
          selectedSessionRef.current = sid;
          setSelectedSessionId(sid);
        }
      });
    }
  };

  const ensurePlaySessionForImages = async (): Promise<string> => {
    if (selectedSessionRef.current) return selectedSessionRef.current;
    const data = (await api('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'chat',
        title: '新会话',
        agentId: agentId || agents[0]?.id,
        autoRun: false,
        background: false,
        ...optionalGroupsBody(optionalToolGroupsFeature, enabledOptionalGroupIds),
        ...modelRefBody(modelRef),
      }),
    })) as { session: { id: string } };
    const sid = data.session.id;
    selectedSessionRef.current = sid;
    setSelectedSessionId(sid);
    requestScrollPlayToBottom();
    sessionListStickTopRef.current = true;
    await tick({ includePlayPanel: true });
    return sid;
  };

  const sendPlayMessage = async () => {
    const text = playInput.trim();
    const imageAssetIds = [...pendingImageAssetIds];
    const running = playSending || Boolean(streamOverlay) || waitTyping;
    if (running) {
      if (!text || !selectedSessionId) return;
      stopSpeechDictation();
      try {
        const data = (await api(`/api/sessions/${selectedSessionId}/steer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, target: 'next-step' }),
        })) as { ok?: boolean; status?: string; reason?: string };
        acknowledgeLocalSendCommitted();
        clearComposerOnly();
        if (data.status === 'rejected' || data.status === 'not_submitted') {
          const why =
            data.reason === 'session_ended'
              ? '会话已结束'
              : data.reason === 'no_session'
                ? '会话不存在'
                : data.reason || '未受理';
          setPlayStatus({ text: `未受理 · ${why}`, err: true });
        } else if (data.status === 'queued') {
          setPlayStatus({ text: '已排队 · 下一枪生效', ok: true });
        } else {
          setPlayStatus({ text: '已提交 · 下一枪生效', ok: true });
        }
      } catch (err) {
        setPlayStatus({ text: err instanceof Error ? err.message : String(err), err: true });
      }
      return;
    }
    stopSpeechDictation();
    if (!text && imageAssetIds.length === 0) return;
    const draftSnapshot = playInput;
    const imageSnapshot = [...pendingImageAssetIds];
    setPlayStatus({ text: '' });
    setPlaySending(true);

    const preview = userPreviewText(text || '(image)', imageAssetIds);
    const beginStreamTurn = () => {
      acknowledgeLocalSendCommitted();
      setOptimisticUser(preview);
      setStreamOverlay({ segments: [] });
      scrollPlayToBottom();
      clearComposerOnly();
    };
    const beginWaitTurn = () => {
      acknowledgeLocalSendCommitted();
      setOptimisticUser(preview);
      setWaitTyping(true);
      scrollPlayToBottom();
      clearComposerOnly();
    };

    try {
      if (selectedSessionId) {
        if (useStream) {
          beginStreamTurn();
          await readSseFetch(
            `/api/sessions/${selectedSessionId}/stream`,
            {
              message: text || '(image)',
              imageAssetIds,
              ...optionalGroupsBody(optionalToolGroupsFeature, enabledOptionalGroupIds),
              ...modelRefBody(modelRef),
            },
            undefined
          );
        } else {
          beginWaitTurn();
          await api(`/api/sessions/${selectedSessionId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: text || '(image)',
              imageAssetIds,
              ...optionalGroupsBody(optionalToolGroupsFeature, enabledOptionalGroupIds),
              ...modelRefBody(modelRef),
            }),
          });
        }
        clearStreamingShell();
        setPlayStatus({ text: '已发送', ok: true });
      } else if (mode === 'chat') {
        if (useStream) {
          beginStreamTurn();
          await readSseFetch('/api/chat/stream', {
            message: text || '(image)',
            title: (text || '图片').slice(0, 60),
            agentId: agentId || agents[0]?.id,
            imageAssetIds,
            ...optionalGroupsBody(optionalToolGroupsFeature, enabledOptionalGroupIds),
            ...modelRefBody(modelRef),
          });
          clearStreamingShell();
          setPlayStatus({ text: '流式完成', ok: true });
        } else {
          beginWaitTurn();
          const data = (await api('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: text || '(image)',
              title: (text || '图片').slice(0, 60),
              agentId: agentId || agents[0]?.id,
              imageAssetIds,
              ...optionalGroupsBody(optionalToolGroupsFeature, enabledOptionalGroupIds),
              ...modelRefBody(modelRef),
            }),
          })) as { session: { id: string } };
          const sid = data.session.id;
          selectedSessionRef.current = sid;
          setSelectedSessionId(sid);
          clearStreamingShell();
          await refreshPlayPanel();
          setPlayStatus({ text: '会话已创建', ok: true });
        }
      } else {
        beginWaitTurn();
        const data = (await api('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'task',
            title: text.slice(0, 80),
            message: text || '(image)',
            imageAssetIds,
            agentId: agentId || agents[0]?.id,
            autoRun: true,
            background: true,
            ...optionalGroupsBody(optionalToolGroupsFeature, enabledOptionalGroupIds),
            ...modelRefBody(modelRef),
          }),
        })) as { session: { id: string } };
        const sid = data.session.id;
        selectedSessionRef.current = sid;
        setSelectedSessionId(sid);
        clearStreamingShell();
        await refreshPlayPanel();
        setPlayStatus({ text: '任务会话已创建', ok: true });
      }
      playStickToBottomRef.current = true;
      sessionListStickTopRef.current = true;
      await tick({ includePlayPanel: true });
      playStickToBottomRef.current = true;
    } catch (e) {
      setPlayStatus({ text: e instanceof Error ? e.message : String(e), err: true });
      setPlayInput(draftSnapshot);
      setPendingImageAssetIds(imageSnapshot);
      clearStreamingShell();
    } finally {
      setPlaySending(false);
    }
  };

  const handleFileUpload = async (files: FileList) => {
    try {
      const sid = await ensurePlaySessionForImages();
      const ids = [...pendingImageAssetIds];
      for (const file of files) {
        const b64 = await fileToBase64Data(file);
        const data = (await api(`/api/sessions/${sid}/images/ingest-base64`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataBase64: b64, mimeType: file.type || 'image/png' }),
        })) as { asset: { id: string } };
        ids.push(data.asset.id);
      }
      setPendingImageAssetIds(ids);
      await tick({ includePlayPanel: true });
    } catch (err) {
      setPlayStatus({ text: err instanceof Error ? err.message : String(err), err: true });
    }
  };

  const handleUrlFetch = async () => {
    const url = imageUrlInput.trim();
    if (!url) return;
    try {
      const sid = await ensurePlaySessionForImages();
      const data = (await api(`/api/sessions/${sid}/images/fetch-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })) as { asset: { id: string } };
      setPendingImageAssetIds((x) => [...x, data.asset.id]);
      setImageUrlInput('');
      await tick({ includePlayPanel: true });
    } catch (err) {
      setPlayStatus({ text: err instanceof Error ? err.message : String(err), err: true });
    }
  };

  // Auto-scroll layout effect
  useLayoutEffect(() => {
    const el = playMessagesRef.current;
    if (!el) return;
    let rAFId1: number | undefined;
    let rAFId2: number | undefined;

    const pendingTurn = streamOverlay != null || waitTyping || optimisticUser != null;
    if (pendingTurn) {
      scrollElToBottom(el);
    } else if (playStickToBottomRef.current) {
      scrollElToBottom(el);
      const wave = ++stickFlushGenRef.current;
      if (stickOuterRafRef.current != null) {
        cancelAnimationFrame(stickOuterRafRef.current);
      }
      rAFId1 = requestAnimationFrame(() => {
        stickOuterRafRef.current = null;
        const el2 = playMessagesRef.current;
        if (el2) scrollElToBottom(el2);
        rAFId2 = requestAnimationFrame(() => {
          if (wave !== stickFlushGenRef.current) return;
          const el3 = playMessagesRef.current;
          if (el3) scrollElToBottom(el3);
          playStickToBottomRef.current = false;
        });
      });
      stickOuterRafRef.current = rAFId1;
    } else if (isNearBottom(el)) {
      scrollElToBottom(el);
    }

    return () => {
      if (rAFId1 !== undefined) cancelAnimationFrame(rAFId1);
      if (rAFId2 !== undefined) cancelAnimationFrame(rAFId2);
    };
  }, [sessionMessages, streamOverlay, optimisticUser, waitTyping]);

  return {
    // State
    sessionMessages,
    playTitle,
    playMeta,
    sessionChrome,
    goalDraft,
    setGoalDraft,
    saveGoalCondition,
    saveAutonomy,
    autonomyLevel: permissionToAutonomy(sessionChrome?.permissionMode),
    playInput,
    setPlayInput,
    imageUrlInput,
    setImageUrlInput,
    pendingImageAssetIds,
    setPendingImageAssetIds,
    playStatus,
    optimisticUser,
    streamOverlay,
    waitTyping,
    playSending,
    composerAckFlash,
    speechDictationAvailable,
    speechDictating,
    toggleSpeechDictation,
    mode,
    setMode,
    agentId,
    setAgentId,
    modelOptions,
    modelRef,
    modelCatalog,
    needsModelSetup: catalogNeedsSetup(modelCatalog),
    applyModelCatalog,
    saveModelRef,
    encodeModelValue,
    decodeModelValue,
    useStream,
    setUseStream,
    showModelView,
    setShowModelView,
    modelViewPayload,
    displayMessages:
      showModelView && modelViewPayload?.modelView ? modelViewPayload.modelView : sessionMessages,
    optionalToolGroupsFeature,
    optionalToolCatalog,
    enabledOptionalGroupIds,
    toggleOptionalGroup,
    // Refs
    playMessagesRef,
    playInputRef,
    // Methods
    refreshPlayPanel,
    requestScrollPlayToBottom,
    sendPlayMessage,
    handleFileUpload,
    handleUrlFetch,
    setPlayTitle,
    setPlayMeta,
    setSessionMessages,
  };
}
