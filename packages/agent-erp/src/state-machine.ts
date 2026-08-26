/**
 * ERP document lifecycle (pure functions).
 *
 *   draft ──submit──► submitted ──post──► posted  (+ ledger entry)
 *     │                   │
 *     └─────reject────────┴──► void       (no ledger)
 */

export type ErpDocStatus = 'draft' | 'submitted' | 'posted' | 'void';

export type ErpDocType = 'journal' | 'invoice' | 'payment' | 'generic';

export interface ErpAuditEvent {
  at: string;
  action: 'create' | 'submit' | 'post' | 'reject' | 'void';
  actor?: string;
  detail?: string;
}

export interface ErpDocument {
  id: string;
  docType: ErpDocType;
  status: ErpDocStatus;
  /** Canonical payload (amount, currency, lines, memo, …). */
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  postedAt?: string;
  voidedAt?: string;
  voidReason?: string;
  /** Set on successful post; used for idempotent re-post. */
  idempotencyKey?: string;
  /** Present only after post — proves the document hit the ledger. */
  ledgerEntryId?: string;
  audit: ErpAuditEvent[];
}

export interface ErpLedgerEntry {
  id: string;
  documentId: string;
  amount: number;
  currency: string;
  memo: string;
  postedAt: string;
  idempotencyKey?: string;
}

export type TransitionOk<T> = { ok: true; value: T };
export type TransitionErr = { ok: false; error: string };
export type TransitionResult<T> = TransitionOk<T> | TransitionErr;

function nowIso(): string {
  return new Date().toISOString();
}

function cloneDoc(doc: ErpDocument): ErpDocument {
  return {
    ...doc,
    payload: { ...doc.payload },
    audit: doc.audit.map((e) => ({ ...e })),
  };
}

function pushAudit(
  doc: ErpDocument,
  action: ErpAuditEvent['action'],
  detail?: string,
  actor?: string
): void {
  doc.audit.push({ at: nowIso(), action, detail, actor });
  doc.updatedAt = nowIso();
}

export function createDraft(input: {
  id: string;
  docType?: ErpDocType;
  payload?: Record<string, unknown>;
  actor?: string;
}): TransitionResult<ErpDocument> {
  const id = String(input.id ?? '').trim();
  if (!id) return { ok: false, error: 'id is required' };
  const at = nowIso();
  const doc: ErpDocument = {
    id,
    docType: input.docType ?? 'generic',
    status: 'draft',
    payload: { ...(input.payload ?? {}) },
    createdAt: at,
    updatedAt: at,
    audit: [{ at, action: 'create', actor: input.actor }],
  };
  return { ok: true, value: doc };
}

/** draft → submitted (pending approval / ready for post). */
export function submitDocument(
  doc: ErpDocument,
  opts?: { actor?: string }
): TransitionResult<ErpDocument> {
  if (doc.status !== 'draft') {
    return { ok: false, error: `cannot submit from status=${doc.status}; expected draft` };
  }
  const next = cloneDoc(doc);
  next.status = 'submitted';
  next.submittedAt = nowIso();
  pushAudit(next, 'submit', undefined, opts?.actor);
  return { ok: true, value: next };
}

/**
 * submitted → posted. Creates a ledger entry. Idempotent when the same
 * idempotencyKey is reused on an already-posted document.
 */
export function postDocument(
  doc: ErpDocument,
  opts?: { actor?: string; idempotencyKey?: string; ledgerEntryId?: string }
): TransitionResult<{ document: ErpDocument; ledger: ErpLedgerEntry | null }> {
  if (doc.status === 'posted') {
    const key = opts?.idempotencyKey?.trim();
    if (key && doc.idempotencyKey === key && doc.ledgerEntryId) {
      // Idempotent replay — no second ledger write.
      return {
        ok: true,
        value: {
          document: cloneDoc(doc),
          ledger: null,
        },
      };
    }
    return { ok: false, error: 'document already posted (provide matching idempotencyKey to replay)' };
  }
  if (doc.status !== 'submitted') {
    return {
      ok: false,
      error: `cannot post from status=${doc.status}; expected submitted (secondary confirmation)`,
    };
  }

  const next = cloneDoc(doc);
  const at = nowIso();
  const ledgerId = opts?.ledgerEntryId?.trim() || `led_${next.id}_${Date.now()}`;
  const amount = Number(next.payload.amount ?? 0);
  const currency = String(next.payload.currency ?? 'CNY');
  const memo = String(next.payload.memo ?? next.payload.description ?? '');

  next.status = 'posted';
  next.postedAt = at;
  next.ledgerEntryId = ledgerId;
  if (opts?.idempotencyKey?.trim()) {
    next.idempotencyKey = opts.idempotencyKey.trim();
  }
  pushAudit(next, 'post', `ledger=${ledgerId}`, opts?.actor);

  const ledger: ErpLedgerEntry = {
    id: ledgerId,
    documentId: next.id,
    amount: Number.isFinite(amount) ? amount : 0,
    currency,
    memo,
    postedAt: at,
    idempotencyKey: next.idempotencyKey,
  };
  return { ok: true, value: { document: next, ledger } };
}

/**
 * draft | submitted → void. Never creates a ledger entry (reject / cancel path).
 */
export function rejectDocument(
  doc: ErpDocument,
  opts?: { actor?: string; reason?: string }
): TransitionResult<ErpDocument> {
  if (doc.status === 'posted') {
    return { ok: false, error: 'cannot reject a posted document; use void only before post' };
  }
  if (doc.status === 'void') {
    return { ok: false, error: 'document already void' };
  }
  const next = cloneDoc(doc);
  next.status = 'void';
  next.voidedAt = nowIso();
  next.voidReason = opts?.reason?.trim() || 'rejected';
  // Explicitly ensure no ledger side-effect.
  delete next.ledgerEntryId;
  pushAudit(next, 'reject', next.voidReason, opts?.actor);
  return { ok: true, value: next };
}

/** Alias used by callers that speak "void" rather than "reject". */
export function voidDocument(
  doc: ErpDocument,
  opts?: { actor?: string; reason?: string }
): TransitionResult<ErpDocument> {
  const r = rejectDocument(doc, opts);
  if (!r.ok) return r;
  // Tag last audit as void for clarity when caller asked for void.
  const next = r.value;
  const last = next.audit[next.audit.length - 1];
  if (last) last.action = 'void';
  return { ok: true, value: next };
}

export function isPosted(doc: ErpDocument): boolean {
  return doc.status === 'posted' && Boolean(doc.ledgerEntryId);
}

export function hasLedgerImpact(doc: ErpDocument): boolean {
  return Boolean(doc.ledgerEntryId) && doc.status === 'posted';
}
