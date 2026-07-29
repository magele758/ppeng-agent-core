/**
 * Micro-compaction (absorbed from ai-agent-node session/micro-compact.ts).
 *
 * Complements the threshold-driven `autoCompact` in the runtime, which only
 * fires once the whole transcript crosses a token budget and then pays for an
 * LLM summarization round. Micro-compaction is the cheap, every-turn half: tool
 * results the model has already acted on are the single largest source of dead
 * context, so keep the last N verbatim and collapse the older ones to a
 * one-line marker. Recent results still get a hard cap, otherwise a single 120k
 * `bash` dump keeps blowing up the window before any threshold trips.
 *
 * Pure over `SessionMessage[]` — returns a new array and never mutates stored
 * rows, so the persisted transcript stays complete and only the model's view
 * shrinks.
 */

import { envBool, envInt } from '../env.js';
import type { MessagePart, SessionMessage } from '../types.js';

export interface MicroCompactConfig {
  enabled: boolean;
  /** Number of most recent tool results kept verbatim. */
  keepRecent: number;
  /** Only replace outputs longer than this with a placeholder. */
  minChars: number;
  /** Hard cap applied even to kept (recent) tool results. */
  hardMaxChars: number;
}

export const DEFAULT_MICRO_COMPACT_CONFIG: MicroCompactConfig = {
  enabled: true,
  keepRecent: 3,
  minChars: 100,
  hardMaxChars: 12_000
};

export function microCompactConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): MicroCompactConfig {
  return {
    enabled: envBool(env, 'RAW_AGENT_MICRO_COMPACT', DEFAULT_MICRO_COMPACT_CONFIG.enabled),
    keepRecent: envInt(
      env,
      'RAW_AGENT_MICRO_COMPACT_KEEP_RECENT',
      DEFAULT_MICRO_COMPACT_CONFIG.keepRecent
    ),
    minChars: envInt(env, 'RAW_AGENT_MICRO_COMPACT_MIN_CHARS', DEFAULT_MICRO_COMPACT_CONFIG.minChars),
    hardMaxChars: envInt(
      env,
      'RAW_AGENT_MICRO_COMPACT_HARD_MAX_CHARS',
      DEFAULT_MICRO_COMPACT_CONFIG.hardMaxChars
    )
  };
}

/** Head+tail trim so both the command echo and the final lines survive. */
function hardTrim(content: string, name: string, hardMaxChars: number): string {
  if (content.length <= hardMaxChars) return content;
  const head = Math.max(500, Math.floor(hardMaxChars * 0.7));
  const tail = Math.max(200, hardMaxChars - head - 64);
  const dropped = content.length - head - tail;
  return [
    `[recent ${name} output trimmed from ${content.length} chars]`,
    content.slice(0, head),
    `…[${dropped} chars truncated]…`,
    content.slice(-tail)
  ].join('\n');
}

export interface MicroCompactStats {
  /** Tool results replaced by a placeholder. */
  collapsed: number;
  /** Recent tool results head/tail trimmed. */
  trimmed: number;
  /** Characters removed from the model's view. */
  charsSaved: number;
}

/**
 * Shrink stale tool results in a message list destined for the model.
 * Failed results are collapsed too — the model has already seen the error and
 * a repeated stack trace is exactly the kind of dead weight this removes.
 */
export function microCompactMessages(
  messages: SessionMessage[],
  config: MicroCompactConfig = microCompactConfigFromEnv()
): { messages: SessionMessage[]; stats: MicroCompactStats } {
  const stats: MicroCompactStats = { collapsed: 0, trimmed: 0, charsSaved: 0 };
  if (!config.enabled) return { messages, stats };

  // Flat index of every tool_result across the list, in transcript order.
  const positions: Array<{ msg: number; part: number }> = [];
  messages.forEach((message, msgIdx) => {
    message.parts.forEach((part, partIdx) => {
      if (part.type === 'tool_result') positions.push({ msg: msgIdx, part: partIdx });
    });
  });
  if (positions.length === 0) return { messages, stats };

  const keepFrom = Math.max(0, positions.length - Math.max(0, config.keepRecent));
  const rewrites = new Map<string, string>();

  positions.forEach((pos, idx) => {
    const part = messages[pos.msg]!.parts[pos.part]!;
    if (part.type !== 'tool_result') return;
    const original = part.content;

    if (idx < keepFrom) {
      if (original.length > config.minChars) {
        const placeholder = `[previous: used ${part.name}${part.ok ? '' : ' (failed)'} — output dropped from context]`;
        rewrites.set(`${pos.msg}:${pos.part}`, placeholder);
        stats.collapsed += 1;
        stats.charsSaved += original.length - placeholder.length;
      }
      return;
    }

    const trimmed = hardTrim(original, part.name, config.hardMaxChars);
    if (trimmed !== original) {
      rewrites.set(`${pos.msg}:${pos.part}`, trimmed);
      stats.trimmed += 1;
      stats.charsSaved += original.length - trimmed.length;
    }
  });

  if (rewrites.size === 0) return { messages, stats };

  const out = messages.map((message, msgIdx) => {
    if (!message.parts.some((_, partIdx) => rewrites.has(`${msgIdx}:${partIdx}`))) {
      return message;
    }
    const parts: MessagePart[] = message.parts.map((part, partIdx) => {
      const replacement = rewrites.get(`${msgIdx}:${partIdx}`);
      if (replacement === undefined || part.type !== 'tool_result') return part;
      return { ...part, content: replacement };
    });
    return { ...message, parts };
  });

  return { messages: out, stats };
}
