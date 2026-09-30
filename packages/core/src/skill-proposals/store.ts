/**
 * File-backed skill proposal queue: one JSON file per proposal under
 * `stateDir/skill-proposals/`, approved skills under `stateDir/skills/<name>/SKILL.md`.
 *
 * Why files (not daemon_control KV): bodies are up to ~20k chars and each decision
 * rewrites a single record; a KV row would rewrite the whole queue on every change.
 * Files keep the queue inspectable next to the installed skills and need no SQL migration.
 * Settings (tiny) stay in KV.
 */

import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { createId, nowIso } from '../id.js';
import {
  SKILL_PROPOSAL_MAX_PENDING,
  SkillProposalError,
  findSecretLikeContent,
  isValidSkillProposalName,
  validateSkillProposalDraft,
  type SkillProposalDraft
} from './validate.js';

export type SkillProposalStatus = 'pending' | 'approved' | 'rejected';
export type SkillProposalKind = 'new' | 'update';

export interface SkillProposalRecord {
  id: string;
  name: string;
  description: string;
  body: string;
  sessionId: string;
  agentId?: string;
  kind: SkillProposalKind;
  /** Existing skill this proposal updates (same name already in the catalog). */
  replaces?: { name: string; source?: string };
  status: SkillProposalStatus;
  createdAt: string;
  decidedAt?: string;
  rejectReason?: string;
  /** Path relative to stateDir, set once approved. */
  installedPath?: string;
}

export type SkillProposalSummary = Omit<SkillProposalRecord, 'body'> & { bodyPreview: string; bodyChars: number };

const ID_RE = /^sp_[0-9a-f]{32}$/;
const PREVIEW_CHARS = 400;

export function userSkillsDir(stateDir: string): string {
  return join(stateDir, 'skills');
}

export function skillProposalsDir(stateDir: string): string {
  return join(stateDir, 'skill-proposals');
}

export function isSkillProposalId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id);
}

export function summarizeSkillProposal(record: SkillProposalRecord): SkillProposalSummary {
  const { body, ...rest } = record;
  return { ...rest, bodyPreview: body.slice(0, PREVIEW_CHARS), bodyChars: body.length };
}

function atomicWrite(path: string, text: string): void {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, path);
}

export function renderSkillMarkdown(record: SkillProposalRecord): string {
  const skillName = record.replaces?.name ?? record.name;
  const description = record.description.replace(/"/g, "'");
  return [
    '---',
    `name: ${skillName}`,
    `description: "${description}"`,
    `proposed-by-session: ${record.sessionId}`,
    `approved-at: ${record.decidedAt ?? nowIso()}`,
    '---',
    '',
    record.body,
    ''
  ].join('\n');
}

export interface CreateSkillProposalInput extends SkillProposalDraft {
  sessionId: string;
  agentId?: string;
  replaces?: { name: string; source?: string };
}

export class SkillProposalStore {
  constructor(private readonly stateDir: string) {}

  private recordPath(id: string): string {
    return join(skillProposalsDir(this.stateDir), `${id}.json`);
  }

  private write(record: SkillProposalRecord): void {
    mkdirSync(skillProposalsDir(this.stateDir), { recursive: true });
    atomicWrite(this.recordPath(record.id), JSON.stringify(record, null, 2));
  }

  list(filter?: { status?: SkillProposalStatus }): SkillProposalRecord[] {
    let files: string[];
    try {
      files = readdirSync(skillProposalsDir(this.stateDir));
    } catch {
      return [];
    }
    const out: SkillProposalRecord[] = [];
    for (const file of files) {
      const id = file.endsWith('.json') ? file.slice(0, -5) : '';
      if (!isSkillProposalId(id)) continue;
      const rec = this.get(id);
      if (rec && (!filter?.status || rec.status === filter.status)) out.push(rec);
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): SkillProposalRecord | undefined {
    if (!isSkillProposalId(id)) return undefined;
    try {
      const parsed = JSON.parse(readFileSync(this.recordPath(id), 'utf8')) as SkillProposalRecord;
      return parsed && parsed.id === id ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  create(input: CreateSkillProposalInput): SkillProposalRecord {
    const draft = validateSkillProposalDraft(input);
    const pending = this.list({ status: 'pending' });
    const sameName = pending.find((p) => p.name === draft.name);
    if (sameName) {
      if (sameName.sessionId !== input.sessionId) {
        throw new SkillProposalError(
          `a pending proposal named "${draft.name}" from another session already exists; choose a different name`,
          'conflict'
        );
      }
      rmSync(this.recordPath(sameName.id), { force: true });
    } else if (pending.length >= SKILL_PROPOSAL_MAX_PENDING) {
      throw new SkillProposalError(
        `review queue is full (${SKILL_PROPOSAL_MAX_PENDING} pending); a human must approve or reject some first`,
        'limit'
      );
    }
    const record: SkillProposalRecord = {
      id: createId('sp'),
      ...draft,
      sessionId: input.sessionId,
      ...(input.agentId ? { agentId: input.agentId } : {}),
      kind: input.replaces ? 'update' : 'new',
      ...(input.replaces ? { replaces: input.replaces } : {}),
      status: 'pending',
      createdAt: nowIso()
    };
    this.write(record);
    return record;
  }

  private requirePending(id: string): SkillProposalRecord {
    const record = this.get(id);
    if (!record) throw new SkillProposalError(`skill proposal ${String(id)} not found`, 'not_found');
    if (record.status !== 'pending') {
      throw new SkillProposalError(`skill proposal is already ${record.status}`, 'conflict');
    }
    return record;
  }

  /** Install into stateDir/skills/<name>/SKILL.md. Never touches repo `skills/` or ~/.agents. */
  approve(id: string): SkillProposalRecord {
    const record = this.requirePending(id);
    // Stored files can be edited out-of-band; re-check before writing anything.
    if (!isValidSkillProposalName(record.name) || basename(record.name) !== record.name) {
      throw new SkillProposalError('stored proposal has an invalid name');
    }
    const secret = findSecretLikeContent(`${record.description}\n${record.body}`);
    if (secret) {
      throw new SkillProposalError(`stored proposal looks like it contains a secret (${secret})`, 'secret');
    }
    const root = resolve(userSkillsDir(this.stateDir));
    const dir = resolve(root, basename(record.name));
    if (!dir.startsWith(root + sep)) {
      throw new SkillProposalError('resolved skill path escapes the user skills directory');
    }
    const decided: SkillProposalRecord = {
      ...record,
      status: 'approved',
      decidedAt: nowIso(),
      installedPath: join('skills', basename(record.name), 'SKILL.md')
    };
    mkdirSync(dir, { recursive: true });
    atomicWrite(join(dir, 'SKILL.md'), renderSkillMarkdown(decided));
    this.write(decided);
    return decided;
  }

  reject(id: string, reason?: string): SkillProposalRecord {
    const record = this.requirePending(id);
    const trimmed = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
    const decided: SkillProposalRecord = {
      ...record,
      status: 'rejected',
      decidedAt: nowIso(),
      ...(trimmed ? { rejectReason: trimmed } : {})
    };
    this.write(decided);
    return decided;
  }
}
