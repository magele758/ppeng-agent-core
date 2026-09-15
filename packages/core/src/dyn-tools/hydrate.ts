/**
 * Pick which dyn-tool records become this turn's extra tools[] entries.
 * Union: session active ∪ sticky used (even if memory was mis-marked draft).
 * P2: shortlist ∪ used when active count exceeds hydrateTopK.
 */

import type { SessionRecord, ToolContract } from '../types.js';
import { lastUserQueryFromMessages } from '../session/context-compiler.js';
import type { SessionMessage } from '../types.js';
import { materializePtcCellTool, type DynToolMaterializeDeps } from './materialize.js';
import { searchDynTools, suggestUnusedRetired } from './search.js';
import { readDynToolSettings, type DynToolSettings, type DynToolSettingsStore } from './settings.js';
import { tryCreateDynToolStore, type DynToolStore } from './store.js';
import { DYN_TOOLS_USED_META_KEY, type DynToolRecord } from './types.js';

export function readDynToolsUsed(session: Pick<SessionRecord, 'metadata'>): string[] {
  const raw = session.metadata?.[DYN_TOOLS_USED_META_KEY];
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((n) => String(n).trim()).filter(Boolean))];
}

export function mergeDynToolsUsed(existing: string[], extra: string[]): string[] {
  return [...new Set([...existing, ...extra.map((n) => String(n).trim()).filter(Boolean)])];
}

export function selectHydrateRecords(input: {
  records: DynToolRecord[];
  usedNames: string[];
  settings: DynToolSettings;
  query?: string;
  applyShortlist?: boolean;
}): DynToolRecord[] {
  const byName = new Map<string, DynToolRecord>();
  for (const rec of input.records) {
    if (rec.status === 'retired') continue;
    byName.set(rec.name, rec);
  }

  const used: DynToolRecord[] = [];
  for (const name of input.usedNames) {
    const rec = byName.get(name);
    if (rec && rec.status !== 'retired') used.push(rec);
  }

  const active = [...byName.values()].filter((r) => r.status === 'active');
  const applyShortlist = input.applyShortlist !== false && active.length > input.settings.hydrateTopK;
  const shortlisted = applyShortlist
    ? searchDynTools(input.query ?? '', active, input.settings.hydrateTopK)
    : active;

  const picked = new Map<string, DynToolRecord>();
  for (const rec of shortlisted) picked.set(rec.name, rec);
  for (const rec of used) picked.set(rec.name, rec);
  return [...picked.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function hydrateTurnDynTools(input: {
  store?: {
    agentMemory?(): unknown;
    getDaemonControl?(key: string): unknown;
    upsertSessionMemory?(...args: never[]): unknown;
    listSessionMemory?(sessionId: string): unknown[];
    deleteSessionMemory?(sessionId: string, scope: 'scratch' | 'long', key: string): boolean;
  };
  session: SessionRecord;
  query?: string;
  materializeDeps: DynToolMaterializeDeps;
  dynStore?: DynToolStore;
  settings?: DynToolSettings;
}): { tools: ToolContract<any>[]; names: string[]; records: DynToolRecord[]; suggestRetired: string[] } {
  const settings = input.settings ?? readDynToolSettings(input.store as DynToolSettingsStore | undefined);
  if (!settings.enabled) {
    return { tools: [], names: [], records: [], suggestRetired: [] };
  }
  const dynStore = input.dynStore ?? (input.store ? tryCreateDynToolStore(input.store as never) : undefined);
  if (!dynStore) {
    return { tools: [], names: [], records: [], suggestRetired: [] };
  }
  const listed = dynStore.list({ sessionId: input.session.id });
  const usedNames = readDynToolsUsed(input.session);
  const records = selectHydrateRecords({
    records: listed,
    usedNames,
    settings,
    query: input.query,
    applyShortlist: true
  });
  const tools: ToolContract<any>[] = [];
  for (const rec of records) {
    try {
      tools.push(materializePtcCellTool(rec, input.materializeDeps));
    } catch {
      /* skip empty / invalid */
    }
  }
  const turn = typeof input.session.metadata?.turnCount === 'number' ? input.session.metadata.turnCount : 0;
  return {
    tools,
    names: tools.map((t) => t.name),
    records,
    suggestRetired: suggestUnusedRetired(listed, Number(turn) || 0, settings.unusedSuggestTurns)
  };
}

export function queryForDynHydrate(messages: SessionMessage[]): string {
  return lastUserQueryFromMessages(messages);
}
