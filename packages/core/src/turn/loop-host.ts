/**
 * L4 host factory: AgentLoopHandle over a caller-owned surface store + L3 kernel.
 * No RawAgentRuntime, no daemon, no AUTH_TOKEN.
 */

import type { AgentLoopHost } from '../runtime/agent-loop.js';
import { mergeOutcomeMetadata, runOutcomeFromEnd } from '../session/run-outcome.js';
import { decideSteerAdmission } from '../session/steer-ack.js';
import { closeOpenToolWave } from '../session/tool-wave-close.js';
import type { SessionSurfaceStore } from '../session/surface-store.js';
import type { SessionRecord } from '../types.js';
import { createEmbedTurnHost } from './embed-host.js';
import { runSessionKernel } from './kernel.js';
import type { RunTurnKernelInput } from './host.js';

type SessionMutatingStore = SessionSurfaceStore & {
  updateSession?(
    sessionId: string,
    patch: Partial<Omit<SessionRecord, 'id' | 'createdAt'>>
  ): SessionRecord;
};

export type TurnKernelLoopHostInput = Omit<RunTurnKernelInput, 'sessionId' | 'latch'>;

export function createTurnKernelLoopHost(input: TurnKernelLoopHostInput): AgentLoopHost {
  const store = input.store as SessionMutatingStore;
  const embedHost = createEmbedTurnHost(input);
  return {
    getSession(id) {
      return store.getSession(id);
    },
    foldMessages(id) {
      return store.foldMessages(id);
    },
    enqueueSteer(id, text, opts) {
      const decision = decideSteerAdmission({ session: store.getSession(id), text });
      if (!decision.admit) {
        return { status: 'not_submitted', reason: decision.reason };
      }
      const item = store.enqueueSteer(id, text, opts);
      return { status: decision.status, item };
    },
    abortSession(id) {
      try {
        closeOpenToolWave(store, id, 'interrupted');
      } catch {
        /* fold/append must not block abort */
      }
      const session = store.getSession(id);
      if (session && typeof store.updateSession === 'function') {
        const outcome = runOutcomeFromEnd({ reason: 'abort', sessionStatus: 'failed' });
        store.updateSession(id, {
          metadata: mergeOutcomeMetadata(session.metadata ?? {}, outcome)
        });
      }
      const controller = embedHost.sessionAbortControllers.get(id);
      controller?.abort();
      embedHost.sessionAbortControllers.delete(id);
    },
    startRun(sessionId, latch, options) {
      return runSessionKernel(embedHost, sessionId, {
        latch,
        onModelStreamChunk: input.onModelStreamChunk,
        steerDrainPolicy: options?.steerDrainPolicy ?? input.steerDrainPolicy
      });
    }
  };
}
