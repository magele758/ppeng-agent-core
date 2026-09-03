/**
 * Context Compiler — assemble the per-turn starting pack by query.
 * Lives in session/turn, not inside Memory. Memory / working-log are sources.
 * Output is user-side appendix only (never system prefix).
 */

import {
  MEMORY_CONTEXT_APPENDIX_PREFIX,
  isMemoryContextAppendixText
} from '../memory/memory-gate.js';
import { recallProgressive, type RecallSources } from '../memory/memory-recall.js';
import { resolveMemorySettings } from '../memory/memory-settings.js';
import type { AgentMemoryStore } from '../memory/store.js';
import type { CompiledContextPack, CompiledContextSlot, ContextSlotId } from '../memory/types.js';
import type { SessionMessage, SessionRecord } from '../types.js';
import { workingLogPath } from './working-log.js';

export { MEMORY_CONTEXT_APPENDIX_PREFIX };

const SLOT_META: Array<{ id: ContextSlotId; title: string; cap: number | null }> = [
  { id: 'userProfile', title: '用户画像（userProfile）', cap: 800 },
  { id: 'core', title: '用户背景（语义 core）', cap: 1500 },
  { id: 'working', title: '相关工作记忆', cap: 2000 },
  { id: 'workingFile', title: '工作日志 / 日文件', cap: 2600 }
];

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

export function compileContextPack(sources: RecallSources, query = ''): CompiledContextPack {
  const raw: Record<ContextSlotId, string> = {
    userProfile: sources.userProfile || '',
    core: sources.core || '',
    working: sources.working || '',
    workingFile: sources.workingFile || ''
  };

  const sections: CompiledContextSlot[] = [];
  for (const meta of SLOT_META) {
    const textRaw = raw[meta.id].trim();
    if (!textRaw) continue; // empty slots omitted
    const capped = meta.cap != null && textRaw.length > meta.cap;
    const text = capped ? `${textRaw.slice(0, meta.cap!)}\n...[已按预算截断]` : textRaw;
    sections.push({
      id: meta.id,
      title: meta.title,
      text,
      chars: text.length,
      capped
    });
  }

  const combined = sections.map((s) => s.text).filter(Boolean).join('\n\n');
  return {
    query,
    sections,
    combined,
    combinedChars: combined.length
  };
}

export function formatCompiledContextPack(pack: CompiledContextPack): string {
  if (!pack.combined.trim()) return '';
  return `${MEMORY_CONTEXT_APPENDIX_PREFIX}\n${pack.combined.trim()}`;
}

export interface CompileTurnAppendixInput {
  session: SessionRecord;
  query: string;
  store?: {
    agentMemory?(): AgentMemoryStore;
    getDaemonControl?(key: string): unknown;
    listSessionMemory?(sessionId: string): Array<{ scope: string; key: string; value: string }>;
  };
  stateDir?: string;
  /** Test / preview override */
  sources?: RecallSources;
}

/**
 * Compile the user-side memory appendix for this turn.
 * Compiler-off → empty (caller may fall back). Fail-soft.
 */
export function compileTurnAppendix(input: CompileTurnAppendixInput): string {
  try {
    const settings = resolveMemorySettings(input.store);
    if (!settings.compilerEnabled) return '';

    if (input.sources) {
      return formatCompiledContextPack(compileContextPack(input.sources, input.query));
    }

    const am = input.store && typeof input.store.agentMemory === 'function' ? input.store.agentMemory() : undefined;
    if (!am) {
      const listed = input.store?.listSessionMemory?.(input.session.id) ?? [];
      const working =
        listed.length === 0
          ? ''
          : [
              '## 相关工作记忆',
              '',
              ...listed.slice(0, 20).map((m) => `- ${m.key}: ${m.value}`)
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
  const formatted = compileTurnAppendix(input);
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
  void formatted;
  return compileContextPack(sources, input.query);
}
