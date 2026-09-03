/**
 * Dreamer — after curator accept, distill facts + journal. Throttled, never blocks the loop.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../logger.js';
import { isSystemTemplateContent } from './memory-gate.js';
import { heuristicExtractDialogueFacts } from './memory-dialogue-extract.js';
import { resolveMemorySettings } from './memory-settings.js';
import { saveSemanticFact } from './memory-writer.js';
import type { AgentMemoryStore } from './store.js';
import type { MemoryDreamRun } from './types.js';

const log = createLogger('memory-dreamer');

export const DREAM_MIN_MESSAGES = 3;
export const DREAM_THROTTLE_MS = 15 * 60 * 1000;

const lastAutoDreamAt = new Map<string, number>();

export type DreamNowResult = 'processed' | 'skipped' | 'throttled' | 'no_user' | 'error';

export function clearDreamThrottleForTest(): void {
  lastAutoDreamAt.clear();
}

export async function dreamNowForUser(input: {
  store: AgentMemoryStore;
  userId: string;
  tenantId?: string;
  messagesText?: string;
  settingsStore?: { getDaemonControl?(key: string): unknown };
  stateDir?: string;
  force?: boolean;
  completeText?: (input: { system: string; user: string }) => Promise<string>;
}): Promise<DreamNowResult> {
  const settings = resolveMemorySettings(input.settingsStore);
  if (!settings.dreamerEnabled && !input.force) return 'skipped';

  const userId = (input.userId || '').trim();
  if (!userId) return 'no_user';

  if (!input.force) {
    const last = lastAutoDreamAt.get(userId) || 0;
    if (Date.now() - last < DREAM_THROTTLE_MS) return 'throttled';
  }

  const date = new Date().toISOString().slice(0, 10);
  const run = input.store.claimDreamRun({
    userId,
    tenantId: input.tenantId,
    dreamDate: date,
    force: input.force === true
  });
  if (!run) return 'skipped';

  try {
    const text = (input.messagesText || '').trim();
    const userLines = (text.match(/^user:/gim) || []).length;
    if (userLines < DREAM_MIN_MESSAGES && !input.force) {
      input.store.finishDreamRun(run.id, { status: 'skipped', factsCount: 0, summary: 'min_messages' });
      return 'skipped';
    }
    if (!text && !input.force) {
      input.store.finishDreamRun(run.id, { status: 'skipped', factsCount: 0, summary: 'no_messages' });
      return 'skipped';
    }

    const facts = heuristicExtractDialogueFacts(text.replace(/^user:\s*/gim, ''));
    let written = 0;
    for (const fact of facts) {
      if (isSystemTemplateContent(fact.content)) continue;
      const saved = saveSemanticFact(input.store, {
        userId,
        tenantId: input.tenantId,
        category: fact.category,
        content: fact.content,
        importance: fact.importance,
        source: 'dream'
      });
      if (saved) written++;
    }

    const journal = `# 梦境日记 ${date}\n\n${facts.map((f) => `- (${f.category}) ${f.content}`).join('\n') || '（无可蒸馏事实）'}\n`;
    if (input.stateDir) {
      try {
        const dir = join(input.stateDir, 'memory-journals', userId);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${date}.md`), journal, 'utf8');
      } catch {
        /* fail-soft */
      }
    }
    input.store.finishDreamRun(run.id, {
      status: 'completed',
      factsCount: written,
      summary: `distilled ${written} facts`,
      journal
    });
    if (!input.force) lastAutoDreamAt.set(userId, Date.now());
    else lastAutoDreamAt.set(userId, Date.now());
    return 'processed';
  } catch (e) {
    log.warn(`dreamNow failed: ${e instanceof Error ? e.message : String(e)}`);
    try {
      input.store.finishDreamRun(run.id, { status: 'error', factsCount: 0, summary: String(e) });
    } catch {
      /* noop */
    }
    return 'error';
  }
}

export function latestDreamRun(store: AgentMemoryStore, userId: string): MemoryDreamRun | null {
  return store.latestDreamRun(userId);
}
