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
import { applyJevMemorySelect } from '../jev/apply.js';
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

function packFromSources(sources: RecallSources, query: string): CompiledContextPack {
  return compileContextPack(sources, query);
}

async function maybeFilterPackByJev(
  store: CompileTurnAppendixInput['store'],
  query: string,
  pack: CompiledContextPack
): Promise<CompiledContextPack> {
  if (!store || pack.sections.length < 2) return pack;
  const kept = await applyJevMemorySelect(
    store,
    query,
    pack.sections.map((s) => ({ id: s.id, text: s.text }))
  );
  if (!kept) return pack;
  const keep = new Set(kept);
  const sections = pack.sections.filter((s) => keep.has(s.id));
  if (sections.length === 0) return pack;
  const combined = sections.map((s) => s.text).filter(Boolean).join('\n\n');
  return {
    ...pack,
    sections,
    combined,
    combinedChars: combined.length
  };
}

function buildSources(input: CompileTurnAppendixInput): RecallSources | null {
  try {
    const settings = resolveMemorySettings(input.store);
    if (!settings.compilerEnabled) return null;

    if (input.sources) return input.sources;

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
      return { userProfile: '', core: '', working, workingFile: '' };
    }

    const userId =
      typeof input.session.metadata?.userId === 'string'
        ? input.session.metadata.userId
        : process.env.RAW_AGENT_DEFAULT_USER_ID?.trim() || undefined;
    const tenantId =
      typeof input.session.metadata?.tenantId === 'string'
        ? input.session.metadata.tenantId
        : process.env.RAW_AGENT_DEFAULT_TENANT_ID?.trim() || undefined;

    return recallProgressive({
      store: am,
      query: input.query,
      userId,
      tenantId,
      sessionId: input.session.id,
      workingLogPath: input.stateDir ? workingLogPath(input.stateDir, input.session.id) : undefined,
      stateDir: input.stateDir,
      embeddings: (id) => am.getEmbedding(id)
    });
  } catch {
    return null;
  }
}

export function compileTurnAppendix(input: CompileTurnAppendixInput): string {
  try {
    const sources = buildSources(input);
    if (!sources) return '';
    return formatCompiledContextPack(packFromSources(sources, input.query));
  } catch {
    return '';
  }
}

/** Turn path: same as compileTurnAppendix, then optional Jev memorySelect on slots. */
export async function compileTurnAppendixAsync(input: CompileTurnAppendixInput): Promise<string> {
  try {
    const sources = buildSources(input);
    if (!sources) return '';
    const pack = await maybeFilterPackByJev(
      input.store,
      input.query,
      packFromSources(sources, input.query)
    );
    return formatCompiledContextPack(pack);
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
