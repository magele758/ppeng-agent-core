/**
 * Model-view annotation for retired dynamic tools.
 * Does not mutate the persisted transcript (same principle as micro-compact).
 */

import type { MessagePart, SessionMessage } from '../types.js';
import { isReservedDynToolName } from './names.js';
import { DYN_TOOL_NAME_RE, DYN_TOOLS_USED_META_KEY } from './types.js';

export function retiredMarker(name: string): string {
  return `[retired:${name}]`;
}

/** Cheap check before listing dyn-tool memory when the Lab switch is off. */
export function messagesMayNeedRetiredAnnotation(
  messages: SessionMessage[],
  session: { metadata?: Record<string, unknown> | null }
): boolean {
  const used = session.metadata?.[DYN_TOOLS_USED_META_KEY];
  if (Array.isArray(used) && used.some((n) => String(n ?? '').trim())) return true;
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type !== 'tool_call' && part.type !== 'tool_result') continue;
      if (DYN_TOOL_NAME_RE.test(part.name) && !isReservedDynToolName(part.name, [])) return true;
    }
  }
  return false;
}

export function annotateRetiredToolParts(
  messages: SessionMessage[],
  retiredNames: Set<string>
): SessionMessage[] {
  if (retiredNames.size === 0) return messages;
  return messages.map((msg) => ({
    ...msg,
    parts: msg.parts.flatMap((part): MessagePart[] => {
      if (part.type === 'tool_call' && retiredNames.has(part.name)) {
        return [part, { type: 'text', text: retiredMarker(part.name) }];
      }
      if (part.type === 'tool_result' && retiredNames.has(part.name)) {
        const marker = retiredMarker(part.name);
        if (part.content.startsWith(marker)) return [part];
        return [{ ...part, content: `${marker}\n${part.content}` }];
      }
      return [part];
    })
  }));
}
