import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TraceEvent } from './trace.js';

export async function readSessionTraceEvents(
  stateDir: string,
  sessionId: string,
  limit = 500
): Promise<TraceEvent[]> {
  const path = join(stateDir, 'traces', sessionId, 'events.jsonl');
  try {
    const raw = await readFile(path, 'utf8');
    const lines = raw
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const events: TraceEvent[] = [];
    for (const line of lines) {
      try {
        events.push(JSON.parse(line) as TraceEvent);
      } catch {
        /* skip bad line */
      }
    }
    const cap = Math.min(Math.max(limit, 1), 5000);
    return events.slice(-cap);
  } catch {
    return [];
  }
}
