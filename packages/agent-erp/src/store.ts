/**
 * In-memory ERP document + ledger store with optional JSON persistence under stateDir.
 * Tests can construct a fresh store without touching disk (`persist: false`).
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ErpDocument, ErpLedgerEntry } from './state-machine.js';

export interface ErpStoreSnapshot {
  documents: Record<string, ErpDocument>;
  ledger: Record<string, ErpLedgerEntry>;
}

export interface ErpStoreOptions {
  /** When set and persist≠false, load/save `erp-docs.json` under this directory. */
  stateDir?: string;
  /** Default true when stateDir is set; false for unit tests. */
  persist?: boolean;
}

export class ErpStore {
  private documents = new Map<string, ErpDocument>();
  private ledger = new Map<string, ErpLedgerEntry>();
  private readonly filePath?: string;
  private readonly persist: boolean;

  constructor(opts: ErpStoreOptions = {}) {
    this.persist = opts.persist ?? Boolean(opts.stateDir);
    this.filePath = opts.stateDir ? join(opts.stateDir, 'erp-docs.json') : undefined;
    if (this.persist && this.filePath) this.load();
  }

  get(id: string): ErpDocument | undefined {
    return this.documents.get(id);
  }

  list(): ErpDocument[] {
    return [...this.documents.values()];
  }

  put(doc: ErpDocument): void {
    this.documents.set(doc.id, doc);
    this.save();
  }

  getLedger(id: string): ErpLedgerEntry | undefined {
    return this.ledger.get(id);
  }

  listLedger(): ErpLedgerEntry[] {
    return [...this.ledger.values()];
  }

  putLedger(entry: ErpLedgerEntry): void {
    this.ledger.set(entry.id, entry);
    this.save();
  }

  /** Find ledger by document id (at most one in this mock). */
  ledgerForDocument(documentId: string): ErpLedgerEntry | undefined {
    for (const e of this.ledger.values()) {
      if (e.documentId === documentId) return e;
    }
    return undefined;
  }

  clear(): void {
    this.documents.clear();
    this.ledger.clear();
  }

  private load(): void {
    if (!this.filePath || !existsSync(this.filePath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf-8')) as ErpStoreSnapshot;
      this.documents = new Map(Object.entries(raw.documents ?? {}));
      this.ledger = new Map(Object.entries(raw.ledger ?? {}));
    } catch {
      // Corrupt file — start empty rather than crash the daemon.
      this.documents = new Map();
      this.ledger = new Map();
    }
  }

  private save(): void {
    if (!this.persist || !this.filePath) return;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const snap: ErpStoreSnapshot = {
        documents: Object.fromEntries(this.documents),
        ledger: Object.fromEntries(this.ledger),
      };
      writeFileSync(this.filePath, JSON.stringify(snap, null, 2), 'utf-8');
    } catch {
      // Best-effort persist; tools still succeed in-memory.
    }
  }
}

/** Process-wide default store (lazy). Tools may override via args._store in tests. */
let defaultStore: ErpStore | undefined;

export function getDefaultStore(stateDir?: string): ErpStore {
  if (!defaultStore) {
    defaultStore = new ErpStore({ stateDir, persist: Boolean(stateDir) });
  }
  return defaultStore;
}

/** Test helper — replace / reset the singleton. */
export function resetDefaultStore(store?: ErpStore): ErpStore {
  defaultStore = store ?? new ErpStore({ persist: false });
  return defaultStore;
}
