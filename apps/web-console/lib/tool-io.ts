import type { ChatMessage, MessagePart } from '@/lib/types';

export type ToolCallPart = Extract<MessagePart, { type: 'tool_call' }>;
export type ToolResultPart = Extract<MessagePart, { type: 'tool_result' }>;

const COMMAND_KEYS = ['command', 'cmd', 'script', 'query', 'url'] as const;

export function formatToolInput(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return input;
  if (typeof input !== 'object') return String(input);
  const rec = input as Record<string, unknown>;
  const keys = Object.keys(rec);
  for (const key of COMMAND_KEYS) {
    const value = rec[key];
    if (typeof value === 'string' && value.trim() && keys.length <= 3) {
      return value;
    }
  }
  return JSON.stringify(input, null, 2);
}

export function previewToolInput(input: unknown, max = 72): string {
  const text = formatToolInput(input).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

/** Pair stored tool_call → tool_result (id first, then same-name FIFO for old rows). */
export function buildToolIoIndex(messages: readonly ChatMessage[]): {
  callsById: Map<string, ToolCallPart>;
  resolvedCallIds: Set<string>;
} {
  const callsById = new Map<string, ToolCallPart>();
  const pendingByName = new Map<string, ToolCallPart[]>();

  for (const m of messages) {
    for (const p of m.parts ?? []) {
      if (p.type !== 'tool_call') continue;
      if (p.toolCallId) callsById.set(p.toolCallId, p);
      const queue = pendingByName.get(p.name) ?? [];
      queue.push(p);
      pendingByName.set(p.name, queue);
    }
  }

  const resolvedCallIds = new Set<string>();
  for (let mi = 0; mi < messages.length; mi += 1) {
    const parts = messages[mi]?.parts ?? [];
    for (let pi = 0; pi < parts.length; pi += 1) {
      const p = parts[pi]!;
      if (p.type !== 'tool_result') continue;
      const name = p.name ?? '';
      let call = p.toolCallId ? callsById.get(p.toolCallId) : undefined;
      if (!call) {
        const queue = pendingByName.get(name) ?? [];
        call = queue.shift();
        if (call && p.toolCallId) callsById.set(p.toolCallId, call);
      } else {
        const queue = pendingByName.get(name) ?? [];
        const i = queue.indexOf(call);
        if (i >= 0) queue.splice(i, 1);
      }
      if (call) callsById.set(toolIoPartKey(mi, pi), call);
      if (call?.toolCallId) resolvedCallIds.add(call.toolCallId);
      if (p.toolCallId) resolvedCallIds.add(p.toolCallId);
    }
  }

  return { callsById, resolvedCallIds };
}

export function toolIoPartKey(msgIndex: number, partIndex: number): string {
  return `m${msgIndex}p${partIndex}`;
}

export function indexToolCalls(messages: readonly ChatMessage[]): Map<string, ToolCallPart> {
  return buildToolIoIndex(messages).callsById;
}

export function indexResolvedToolCallIds(messages: readonly ChatMessage[]): Set<string> {
  return buildToolIoIndex(messages).resolvedCallIds;
}

export function hasVisibleStructuredParts(
  parts: readonly MessagePart[] | undefined,
  resolvedCallIds: ReadonlySet<string>
): boolean {
  for (const p of parts ?? []) {
    if (p.type === 'tool_call' && resolvedCallIds.has(p.toolCallId)) continue;
    if (p.type === 'text' && !(p.text ?? '').trim()) continue;
    if (p.type === 'reasoning' && !(p.text ?? '').trim()) continue;
    return true;
  }
  return false;
}
