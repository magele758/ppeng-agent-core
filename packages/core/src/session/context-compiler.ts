/**
 * Product recall / SQLite memory I/O around A's compile + format.
 */

import {
  compileContextPack,
  formatCompiledContextPack
} from '@ppeng/agent-loop';
import type { CompiledContextPack, RecallSources } from '@ppeng/agent-loop';
import {
  MEMORY_CONTEXT_APPENDIX_PREFIX,
  isMemoryContextAppendixText
} from '../memory/memory-gate.js';
import { recallProgressive } from '../memory/memory-recall.js';
import { resolveMemorySettings } from '../memory/memory-settings.js';
import { decodePtcStoredValue, isPtcAppendixEligible } from '../memory/ptc-meta.js';
import type { AgentMemoryStore } from '../memory/store.js';
import type { SessionMessage, SessionRecord } from '../types.js';
import { workingLogPath } from './working-log.js';

export {
  compileContextPack,
  formatCompiledContextPack,
  MEMORY_CONTEXT_APPENDIX_PREFIX
};
export type { CompiledContextPack, RecallSources };

export function lastUserQueryFromMessages(messages: SessionMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'user') continue;
    const texts = m.parts
      .filter((p): p is Extract<(typeof m.parts)[number], { type: 'text' }> => p.type === 'text')
      .map((p) => p.text.trim())
      .filter(Boolean)
      .filter((t) => !isMemoryContextAppendixText(t));
    if (texts.length > 0) return texts[texts.length - 1]!;
  }
  return '';
}

export interface CompileTurnAppendixInput {
  session: SessionRecord;
  query: string;
  store?: {
    agentMemory?(): AgentMemoryStore;
    getDaemonControl?(key: string): unknown;
    listSessionMemory?(
      sessionId: string
    ): Array<{ scope: string; key: string; value: string; metadata?: Record<string, unknown> }>;
  };
  stateDir?: string;
  sources?: RecallSources;
}

export function compileTurnAppendix(input: CompileTurnAppendixInput): string {
  try {
    const settings = resolveMemorySettings(input.store);
    if (!settings.compilerEnabled) return '';

    if (input.sources) {
      return formatCompiledContextPack(compileContextPack(input.sources, input.query));
    }

    const am = input.store && typeof input.store.agentMemory === 'function' ? input.store.agentMemory() : undefined;
    if (!am) {
      const listed = (input.store?.listSessionMemory?.(input.session.id) ?? []).filter((m) => {
        if (m.metadata?.source === 'dyn-tool' || m.metadata?.namespace === 'dyn-tools') {
          return m.metadata?.pin === true;
        }
        return isPtcAppendixEligible(m);
      });
      const working =
        listed.length === 0
          ? ''
          : [
              '## 相关工作记忆',
              '',
              ...listed
                .slice(0, 20)
                .map((m) => `- ${m.key}: ${decodePtcStoredValue(String(m.value ?? '')).value}`)
            ].join('\n');
      return formatCompiledContextPack(
        compileContextPack({ userProfile: '', core: '', working, workingFile: '' }, input.query)
      );
    }

    const userId =
      typeof input.session.metadata?.userId === 'string'
        ? input.session.metadata.userId
        : process.env.RAW_AGENT_DEFAULT_USER_ID?.trim() || undefined;
    const tenantId =
      typeof input.session.metadata?.tenantId === 'string'
        ? input.session.metadata.tenantId
        : process.env.RAW_AGENT_DEFAULT_TENANT_ID?.trim() || undefined;

    const sources = recallProgressive({
      store: am,
      query: input.query,
      userId,
      tenantId,
      sessionId: input.session.id,
      workingLogPath: input.stateDir ? workingLogPath(input.stateDir, input.session.id) : undefined,
      stateDir: input.stateDir,
      embeddings: (id) => am.getEmbedding(id)
    });
    return formatCompiledContextPack(compileContextPack(sources, input.query));
  } catch {
    return '';
  }
}

export function previewContextPack(input: CompileTurnAppendixInput): CompiledContextPack {
  if (input.sources) return compileContextPack(input.sources, input.query);
  const am = input.store && typeof input.store.agentMemory === 'function' ? input.store.agentMemory() : undefined;
  if (!am) {
    return compileContextPack({ userProfile: '', core: '', working: '', workingFile: '' }, input.query);
  }
  const userId =
    typeof input.session.metadata?.userId === 'string' ? input.session.metadata.userId : undefined;
  const sources = recallProgressive({
    store: am,
    query: input.query,
    userId,
    sessionId: input.session.id,
    workingLogPath: input.stateDir ? workingLogPath(input.stateDir, input.session.id) : undefined,
    stateDir: input.stateDir,
    embeddings: (id) => am.getEmbedding(id)
  });
  return compileContextPack(sources, input.query);
}
