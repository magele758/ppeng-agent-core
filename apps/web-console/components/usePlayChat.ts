'use client';

import { api } from '@/lib/api';
import { renderMarkdown } from '@/lib/markdown';
import type { StreamSegment } from '@/lib/stream-segments';
import { feedSseBuffer } from '@/lib/sse';
import { userPreviewText } from '@/lib/chat-utils';
import type { AgentInfo, ChatMessage } from '@/lib/types';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

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
  const [playInput, setPlayInput] = useState('');
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [pendingImageAssetIds, setPendingImageAssetIds] = useState<string[]>([]);
  const [playStatus, setPlayStatus] = useState<{ text: string; ok?: boolean; err?: boolean }>({ text: '' });
  const [optimisticUser, setOptimisticUser] = useState<string | null>(null);
  const [streamOverlay, setStreamOverlay] = useState<{ segments: StreamSegment[] } | null>(null);
  const [waitTyping, setWaitTyping] = useState(false);
  const [playSending, setPlaySending] = useState(false);
  const [mode, setMode] = useState<'chat' | 'task'>('chat');
  const [agentId, setAgentId] = useState('');
  const [useStream, setUseStream] = useState(true);

  const playMessagesRef = useRef<HTMLDivElement>(null);
  const playInputRef = useRef<HTMLTextAreaElement>(null);
  const playStickToBottomRef = useRef(false);
  const stickFlushGenRef = useRef(0);
  const stickOuterRafRef = useRef<number | null>(null);

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

  const refreshPlayPanel = useCallback(async () => {
    const sid = selectedSessionRef.current;
    if (!sid) {
      setPlayTitle('选择或创建会话');
      setPlayMeta('');
      setSessionMessages([]);
      return;
    }
    try {
      const data = (await api(`/api/sessions/${sid}`)) as {
        session: { title: string; mode: string; status: string; agentId: string };
        messages: ChatMessage[];
      };
      setPlayTitle(data.session.title || sid.slice(0, 12));
      setPlayMeta(`${data.session.mode} · ${data.session.status} · agent=${data.session.agentId}`);
      setSessionMessages(data.messages ?? []);
    } catch {
      setPlayTitle('加载失败');
      setPlayMeta('');
      setSessionMessages([]);
    }
  }, [selectedSessionRef]);

  const readSseFetch = async (url: string, body: unknown, onSession?: (id: string) => void) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
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
    if (playSending) return;
    const text = playInput.trim();
    const imageAssetIds = [...pendingImageAssetIds];
    if (!text && imageAssetIds.length === 0) return;
    const draftSnapshot = playInput;
    const imageSnapshot = [...pendingImageAssetIds];
    setPlayStatus({ text: '' });
    setPlaySending(true);

    try {
      if (selectedSessionId) {
        if (useStream) {
          setOptimisticUser(userPreviewText(text || '(image)', imageAssetIds));
          setStreamOverlay({ segments: [] });
          scrollPlayToBottom();
          clearComposerOnly();
          await readSseFetch(`/api/sessions/${selectedSessionId}/stream`, { message: text || '(image)', imageAssetIds }, undefined);
        } else {
          setOptimisticUser(userPreviewText(text || '(image)', imageAssetIds));
          setWaitTyping(true);
          scrollPlayToBottom();
          clearComposerOnly();
          await api(`/api/sessions/${selectedSessionId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text || '(image)', imageAssetIds }),
          });
        }
        clearStreamingShell();
        setPlayStatus({ text: '已发送', ok: true });
      } else if (mode === 'chat') {
        if (useStream) {
          setOptimisticUser(userPreviewText(text || '(image)', imageAssetIds));
          setStreamOverlay({ segments: [] });
          scrollPlayToBottom();
          clearComposerOnly();
          await readSseFetch('/api/chat/stream', {
            message: text || '(image)',
            title: (text || '图片').slice(0, 60),
            agentId: agentId || agents[0]?.id,
            imageAssetIds,
          });
          clearStreamingShell();
          setPlayStatus({ text: '流式完成', ok: true });
        } else {
          setOptimisticUser(userPreviewText(text || '(image)', imageAssetIds));
          setWaitTyping(true);
          scrollPlayToBottom();
          clearComposerOnly();
          const data = (await api('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: text || '(image)',
              title: (text || '图片').slice(0, 60),
              agentId: agentId || agents[0]?.id,
              imageAssetIds,
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
        setOptimisticUser(userPreviewText(text || '(image)', imageAssetIds));
        setWaitTyping(true);
        scrollPlayToBottom();
        clearComposerOnly();
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
    mode,
    setMode,
    agentId,
    setAgentId,
    useStream,
    setUseStream,
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
