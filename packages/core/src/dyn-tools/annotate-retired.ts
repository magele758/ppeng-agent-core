/**
 * Model-view annotation for retired dynamic tools.
 * Does not mutate the persisted transcript (same principle as micro-compact).
 */

import type { MessagePart, SessionMessage } from '../types.js';

export function retiredMarker(name: string): string {
  return `[retired:${name}]`;
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
