/**
 * Agent-first social post scheduling: structured payload stored on {@link TaskRecord.metadata}
 * (no extra DB tables). Used by `schedule_social_post` and daemon / gateway dispatch.
 */
import { createId, nowIso } from './id.js';

/** Key on task.metadata holding {@link SocialPostScheduleV1}. */
export const SOCIAL_POST_SCHEDULE_METADATA_KEY = 'socialPostSchedule' as const;

/** Discriminator for filtering task lists / Ops UI. */
export const SOCIAL_POST_TASK_KIND = 'social_post_schedule' as const;

export type SocialPostApprovalState = 'draft' | 'pending_approval' | 'approved' | 'rejected';

export type SocialPostDispatchState = 'pending' | 'in_flight' | 'succeeded' | 'failed' | 'skipped';

/** Built-in logical providers (validated at schedule time). */
export const BUILTIN_SOCIAL_CHANNELS = new Set([
  'x',
  'linkedin',
  'bluesky',
  'threads',
  'mastodon',
  'facebook',
  'instagram'
]);

export interface SocialPostScheduleV1 {
  version: 1;
  body: string;
  /** Logical targets, e.g. `x`, `linkedin`, or `webhook:<gateway channel id>`. */
  channels: string[];
  /** ISO 8601 instant when the post should go out (UTC). */
  publishAt: string;
  approval: SocialPostApprovalState;
  dispatch: {
    state: SocialPostDispatchState;
    lastAttemptAt?: string;
    /** Provider-specific id or dedupe handle after successful publish. */
    externalRef?: string;
    lastError?: string;
  };
  firstComment?: string;
  /** Free-text hint for auto-reply / follow-up automation (future). */
  followUpHint?: string;
  /** Stable key so retries do not duplicate outbound posts once dispatch is wired. */
  idempotencyKey: string;
  createdAt: string;
}

/**
 * ISO-8601 calendar instant with explicit UTC (`Z`) or numeric offset (`±HH:MM`).
 * Rejects date-only strings, locale-shaped dates, and naive local datetimes (no zone).
 */
const ISO_INSTANT_WITH_EXPLICIT_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/i;

/** Parse and normalize to UTC `...Z` with millisecond precision, or `undefined` if invalid. */
export function normalizePublishAtToUtc(iso: string): string | undefined {
  const s = iso.trim();
  if (!ISO_INSTANT_WITH_EXPLICIT_OFFSET.test(s)) return undefined;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return undefined;
  return new Date(t).toISOString();
}

export function isValidIsoInstant(iso: string): boolean {
  return normalizePublishAtToUtc(iso) !== undefined;
}

/** Normalize channel labels (trim, alias, dedupe). */
export function normalizeSocialChannels(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') return undefined;
    const t = item.trim().toLowerCase();
    if (!t) return undefined;
    const mapped = t === 'twitter' ? 'x' : t;
    if (!seen.has(mapped)) {
      seen.add(mapped);
      out.push(mapped);
    }
  }
  return out.length ? out : undefined;
}

export function validateNormalizedSocialChannels(
  channels: string[],
  gatewayChannelIds: ReadonlySet<string>
): { ok: true } | { ok: false; error: string } {
  for (const ch of channels) {
    if (ch.startsWith('webhook:')) {
      const id = ch.slice('webhook:'.length).trim();
      if (!id) {
        return { ok: false, error: 'invalid webhook channel (empty id after webhook:)' };
      }
      if (!gatewayChannelIds.has(id)) {
        return {
          ok: false,
          error: `webhook channel id is not configured in gateway.config.json channels: ${id}`
        };
      }
      continue;
    }
    if (!BUILTIN_SOCIAL_CHANNELS.has(ch)) {
      return {
        ok: false,
        error: `unsupported social channel: ${ch}. Use a built-in label (${[...BUILTIN_SOCIAL_CHANNELS].sort().join(', ')}) or webhook:<gateway_channel_id>.`
      };
    }
  }
  return { ok: true };
}

const MAX_BODY = 32_000;
const MAX_FIRST_COMMENT = 8_000;
const MAX_FOLLOW_HINT = 4_000;

export interface BuildSocialScheduleInput {
  body: string;
  channels: unknown;
  publishAt: string;
  approval?: SocialPostApprovalState;
  firstComment?: string;
  followUpHint?: string;
  idempotencyKey?: string;
  gatewayChannelIds?: ReadonlySet<string>;
}

export type SocialScheduleBuildResult =
  | { ok: true; schedule: SocialPostScheduleV1 }
  | { ok: false; error: string };

export function buildSocialPostSchedule(input: BuildSocialScheduleInput): SocialScheduleBuildResult {
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (!body) {
    return { ok: false, error: 'body is required' };
  }
  if (body.length > MAX_BODY) {
    return { ok: false, error: `body exceeds ${MAX_BODY} characters` };
  }

  const channels = normalizeSocialChannels(input.channels);
  if (!channels) {
    return { ok: false, error: 'channels must be a non-empty array of non-empty strings' };
  }

  const gatewayIds = input.gatewayChannelIds ?? new Set<string>();
  const chk = validateNormalizedSocialChannels(channels, gatewayIds);
  if (!chk.ok) {
    return { ok: false, error: chk.error };
  }

  const publishAtRaw = typeof input.publishAt === 'string' ? input.publishAt.trim() : '';
  const publishAt = publishAtRaw ? normalizePublishAtToUtc(publishAtRaw) : undefined;
  if (!publishAt) {
    return {
      ok: false,
      error:
        'publishAt must be an ISO 8601 instant with explicit UTC (Z) or offset (±HH:MM), e.g. 2026-04-18T12:00:00Z'
    };
  }

  let firstComment: string | undefined;
  if (input.firstComment !== undefined) {
    if (typeof input.firstComment !== 'string') {
      return { ok: false, error: 'firstComment must be a string when provided' };
    }
    const fc = input.firstComment.trim();
    if (fc.length > MAX_FIRST_COMMENT) {
      return { ok: false, error: `firstComment exceeds ${MAX_FIRST_COMMENT} characters` };
    }
    firstComment = fc || undefined;
  }

  let followUpHint: string | undefined;
  if (input.followUpHint !== undefined) {
    if (typeof input.followUpHint !== 'string') {
      return { ok: false, error: 'followUpHint must be a string when provided' };
    }
    const fh = input.followUpHint.trim();
    if (fh.length > MAX_FOLLOW_HINT) {
      return { ok: false, error: `followUpHint exceeds ${MAX_FOLLOW_HINT} characters` };
    }
    followUpHint = fh || undefined;
  }

  const allowedApproval: SocialPostApprovalState[] = ['draft', 'pending_approval', 'approved', 'rejected'];
  const approval =
    input.approval && allowedApproval.includes(input.approval) ? input.approval : 'pending_approval';

  let idempotencyKey =
    typeof input.idempotencyKey === 'string' && input.idempotencyKey.trim()
      ? input.idempotencyKey.trim()
      : '';
  if (!idempotencyKey) {
    idempotencyKey = createId('soc');
  }

  const schedule: SocialPostScheduleV1 = {
    version: 1,
    body,
    channels,
    publishAt,
    approval,
    dispatch: { state: 'pending' },
    firstComment,
    followUpHint,
    idempotencyKey,
    createdAt: nowIso()
  };

  return { ok: true, schedule };
}

export function readSocialPostSchedule(metadata: Record<string, unknown> | undefined): SocialPostScheduleV1 | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const raw = metadata[SOCIAL_POST_SCHEDULE_METADATA_KEY];
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1 || typeof o.body !== 'string' || !Array.isArray(o.channels)) return undefined;
  return raw as SocialPostScheduleV1;
}

export function taskTitleForSocialSchedule(body: string): string {
  const line = body.split(/\r?\n/).find((l) => l.trim()) ?? body;
  const snippet = line.trim().slice(0, 72);
  return `[Social] ${snippet}${line.trim().length > 72 ? '…' : ''}`;
}

export type SocialPostDeliverFn = (
  channel: string,
  body: string,
  firstComment?: string
) => Promise<{ ok: boolean; detail: string }>;

export async function runSocialPostScheduleDelivery(
  schedule: SocialPostScheduleV1,
  deliver: SocialPostDeliverFn
): Promise<{ schedule: SocialPostScheduleV1; ok: boolean; error?: string }> {
  if (schedule.dispatch.state === 'succeeded') {
    return { schedule, ok: true };
  }

  const attemptAt = nowIso();
  let lastFail = '';
  const lines: string[] = [];
  let allOk = true;

  if (schedule.channels.length === 0) {
    return {
      ok: false,
      error: 'no channels',
      schedule: {
        ...schedule,
        dispatch: {
          state: 'failed',
          lastAttemptAt: attemptAt,
          lastError: 'no channels'
        }
      }
    };
  }

  for (const ch of schedule.channels) {
    const r = await deliver(ch, schedule.body, schedule.firstComment);
    lines.push(`${ch}:${r.ok ? 'ok' : r.detail}`);
    if (!r.ok) {
      allOk = false;
      lastFail = r.detail;
    }
  }

  if (allOk) {
    return {
      ok: true,
      schedule: {
        ...schedule,
        dispatch: {
          state: 'succeeded',
          lastAttemptAt: attemptAt,
          externalRef: lines.join(';').slice(0, 500)
        }
      }
    };
  }

  return {
    ok: false,
    error: lastFail || 'dispatch failed',
    schedule: {
      ...schedule,
      dispatch: {
        state: 'failed',
        lastAttemptAt: attemptAt,
        lastError: lastFail || 'dispatch failed'
      }
    }
  };
}
