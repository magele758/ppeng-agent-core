/**
 * Read stored tool_result rows by the address a micro-compact stub carries.
 * Only searches the message list the caller passes — HTTP / tools must scope
 * that list to the current session.
 */

import { NotFoundError, ValidationError } from '../errors.js';
import type { SessionMessage, ToolResultPart } from '../types.js';
import { parseToolResultStubRef } from './tool-result-stub.js';

export interface ToolResultLookup {
  messageId?: string;
  partIndex?: number;
  seq?: number;
  toolCallId?: string;
  /** Paste a stub line; parsed address is merged (explicit fields win). */
  stub?: string;
}

export interface StoredToolResult {
  sessionId: string;
  messageId: string;
  partIndex: number;
  seq?: number;
  name: string;
  ok: boolean;
  toolCallId: string;
  content: string;
}

export interface ToolResultRetrieveStore {
  getSession(id: string): { id: string } | undefined;
  listMessages(sessionId: string): SessionMessage[];
}

function asToolResult(part: SessionMessage['parts'][number] | undefined): ToolResultPart | undefined {
  return part && part.type === 'tool_result' ? part : undefined;
}

function toStored(message: SessionMessage, partIndex: number, part: ToolResultPart): StoredToolResult {
  return {
    sessionId: message.sessionId,
    messageId: message.id,
    partIndex,
    seq: message.seq,
    name: part.name,
    ok: part.ok,
    toolCallId: part.toolCallId,
    content: part.content
  };
}

function pickPart(message: SessionMessage, ref: ToolResultLookup): StoredToolResult | undefined {
  if (typeof ref.toolCallId === 'string' && ref.toolCallId) {
    const idx = message.parts.findIndex(
      (part) => part.type === 'tool_result' && part.toolCallId === ref.toolCallId
    );
    if (idx >= 0) {
      const part = asToolResult(message.parts[idx]);
      if (part) return toStored(message, idx, part);
    }
  }
  const partIndex = typeof ref.partIndex === 'number' && Number.isFinite(ref.partIndex) ? ref.partIndex : 0;
  if (partIndex < 0 || partIndex >= message.parts.length) return undefined;
  const part = asToolResult(message.parts[partIndex]);
  return part ? toStored(message, partIndex, part) : undefined;
}

export function resolveToolResultLookup(input: ToolResultLookup | string): ToolResultLookup {
  if (typeof input === 'string') {
    const parsed = parseToolResultStubRef(input);
    return parsed ?? { stub: input };
  }
  const fromStub = input.stub ? parseToolResultStubRef(input.stub) : undefined;
  return {
    messageId: input.messageId || fromStub?.messageId,
    partIndex: input.partIndex ?? fromStub?.partIndex,
    seq: input.seq ?? fromStub?.seq,
    toolCallId: input.toolCallId,
    stub: input.stub
  };
}

/**
 * Find a stored tool_result inside an already-scoped message list.
 * Returns undefined when the pointer does not resolve.
 */
export function retrieveStoredToolResult(
  messages: SessionMessage[],
  refInput: ToolResultLookup | string
): StoredToolResult | undefined {
  const ref = resolveToolResultLookup(refInput);
  if (ref.messageId) {
    const message = messages.find((row) => row.id === ref.messageId);
    return message ? pickPart(message, ref) : undefined;
  }
  if (typeof ref.seq === 'number' && Number.isFinite(ref.seq)) {
    const message = messages.find((row) => row.seq === ref.seq);
    return message ? pickPart(message, ref) : undefined;
  }
  if (ref.toolCallId) {
    for (const message of messages) {
      const hit = pickPart(message, ref);
      if (hit) return hit;
    }
  }
  return undefined;
}

/**
 * Session-scoped retrieve used by the HTTP API. Never searches another session.
 */
export function retrieveSessionToolResult(
  store: ToolResultRetrieveStore,
  sessionId: string,
  refInput: ToolResultLookup | string
): StoredToolResult {
  const session = store.getSession(sessionId);
  if (!session) throw new NotFoundError('Session', sessionId);
  const ref = resolveToolResultLookup(refInput);
  if (!ref.messageId && ref.seq === undefined && !ref.toolCallId) {
    throw new ValidationError('messageId, seq, or toolCallId is required');
  }
  const found = retrieveStoredToolResult(store.listMessages(sessionId), ref);
  if (!found) {
    throw new NotFoundError('tool_result', ref.messageId ?? String(ref.seq ?? ref.toolCallId ?? ''));
  }
  return found;
}

export function storedToolResultToJson(row: StoredToolResult): StoredToolResult & { chars: number } {
  return { ...row, chars: row.content.length };
}
