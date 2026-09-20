/**
 * Context compiler — agent-side pack (query → slots → user appendix).
 * Recall / memory-store I/O stays in the product; inject sources via io.
 */

import { lastUserQueryFromMessages } from '../turn/prepare-turn-input.js';

export { lastUserQueryFromMessages };

export const MEMORY_CONTEXT_APPENDIX_PREFIX =
  '本轮相关记忆与用户背景（仅供参考；如与用户最新指令冲突，以最新指令为准）：';

export type ContextSlotId = 'userProfile' | 'core' | 'working' | 'workingFile';

export interface CompiledContextSlot {
  id: ContextSlotId;
  title: string;
  text: string;
  chars: number;
  capped: boolean;
}

export interface CompiledContextPack {
  query: string;
  sections: CompiledContextSlot[];
  combined: string;
  combinedChars: number;
}

export interface RecallSources {
  userProfile: string;
  core: string;
  working: string;
  workingFile: string;
}

const SLOT_META: Array<{ id: ContextSlotId; title: string; cap: number | null }> = [
  { id: 'userProfile', title: '用户画像（userProfile）', cap: 800 },
  { id: 'core', title: '用户背景（语义 core）', cap: 1500 },
  { id: 'working', title: '相关工作记忆', cap: 2000 },
  { id: 'workingFile', title: '工作日志 / 日文件', cap: 2600 },
];

export function compileContextPack(sources: RecallSources, query = ''): CompiledContextPack {
  const raw: Record<ContextSlotId, string> = {
    userProfile: sources.userProfile || '',
    core: sources.core || '',
    working: sources.working || '',
    workingFile: sources.workingFile || '',
  };

  const sections: CompiledContextSlot[] = [];
  for (const meta of SLOT_META) {
    const textRaw = raw[meta.id].trim();
    if (!textRaw) continue;
    const capped = meta.cap != null && textRaw.length > meta.cap;
    const text = capped ? `${textRaw.slice(0, meta.cap!)}\n...[已按预算截断]` : textRaw;
    sections.push({
      id: meta.id,
      title: meta.title,
      text,
      chars: text.length,
      capped,
    });
  }

  const combined = sections.map((s) => s.text).filter(Boolean).join('\n\n');
  return {
    query,
    sections,
    combined,
    combinedChars: combined.length,
  };
}

export function formatCompiledContextPack(pack: CompiledContextPack): string {
  if (!pack.combined.trim()) return '';
  return `${MEMORY_CONTEXT_APPENDIX_PREFIX}\n${pack.combined.trim()}`;
}

export function compileAppendixFromSources(sources: RecallSources, query = ''): string {
  return formatCompiledContextPack(compileContextPack(sources, query));
}
