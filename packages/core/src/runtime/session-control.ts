/**
 * cancelSession / destroy extracted from RawAgentRuntime.
 */

import type { McpManager } from '../mcp/mcp-manager.js';
import { mergeOutcomeMetadata, runOutcomeFromEnd } from '../session/run-outcome.js';
import { closeOpenToolWave } from '../session/tool-wave-close.js';
import type { SqliteStateStore } from '../storage.js';
import type { TraceEvent } from '../stores/trace.js';

export interface SessionControlHost {
  store: SqliteStateStore;
  sessionAbortControllers: Map<string, AbortController>;
  backgroundJobAborts: Map<string, AbortController>;
  emitTrace(sessionId: string, event: Omit<TraceEvent, 'ts' | 'sessionId'>): void;
}

export function cancelSession(host: SessionControlHost, sessionId: string): void {
  try {
    closeOpenToolWave(host.store, sessionId, 'interrupted');
  } catch {
    /* fold/append must not block abort */
  }
  const session = host.store.getSession(sessionId);
  if (session) {
    const outcome = runOutcomeFromEnd({ reason: 'abort', sessionStatus: 'failed' });
    host.store.updateSession(sessionId, {
      metadata: mergeOutcomeMetadata(session.metadata ?? {}, outcome)
    });
  }
  const controller = host.sessionAbortControllers.get(sessionId);
  controller?.abort();
  host.sessionAbortControllers.delete(sessionId);
  for (const jobId of [...host.backgroundJobAborts.keys()]) {
    const ac = host.backgroundJobAborts.get(jobId);
    if (!ac) continue;
    const job = host.store.getBackgroundJob(jobId);
    if (job?.sessionId === sessionId) {
      ac.abort();
      host.backgroundJobAborts.delete(jobId);
    }
  }
  void host.emitTrace(sessionId, { kind: 'cancel', payload: {} });
}

export async function destroyRuntime(input: {
  sessionAbortControllers: Map<string, AbortController>;
  backgroundJobAborts: Map<string, AbortController>;
  mcpManager: McpManager;
  store: SqliteStateStore;
}): Promise<void> {
  for (const ac of input.sessionAbortControllers.values()) {
    try { ac.abort(); } catch { /* best effort */ }
  }
  input.sessionAbortControllers.clear();

  for (const [, ac] of input.backgroundJobAborts) {
    try { ac.abort(); } catch { /* best effort */ }
  }
  input.backgroundJobAborts.clear();

  await input.mcpManager.destroy();

  try { input.store.db.close(); } catch { /* best effort — may already be closed */ }
}
