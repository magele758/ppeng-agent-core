import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export type TraceEventKind = 'turn_start' | 'turn_end' | 'tool_start' | 'tool_end' | 'model_error' | 'compact' | 'cancel';

export interface TraceEvent {
  ts: string;
  sessionId: string;
  kind: TraceEventKind;
  payload?: Record<string, unknown>;
}

export async function appendTraceEvent(stateDir: string, sessionId: string, event: Omit<TraceEvent, 'ts' | 'sessionId'>): Promise<void> {
  const dir = join(stateDir, 'traces', sessionId);
  await mkdir(dir, { recursive: true });
  const line: TraceEvent = {
    ts: new Date().toISOString(),
    sessionId,
    ...event
  };
  const file = join(dir, 'events.jsonl');
  await appendFile(file, `${JSON.stringify(line)}\n`, 'utf8');
}
