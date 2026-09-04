import { NotFoundError } from '../errors.js';
import type { SessionRecord, TaskRecord } from '../types.js';
import type { AuthUser, RequestAuth } from './types.js';

export const ANONYMOUS_AUTH: RequestAuth = { isolate: false, labProxy: false, user: null };

export function sessionOwnerId(session: { metadata?: Record<string, unknown> }): string | undefined {
  const raw = session.metadata?.userId;
  if (typeof raw !== 'string') return undefined;
  const id = raw.trim();
  return id || undefined;
}

export function canAccessSession(
  session: { metadata?: Record<string, unknown> },
  auth: RequestAuth
): boolean {
  if (!auth.isolate || !auth.user) return true;
  return sessionOwnerId(session) === auth.user.id;
}

export function filterSessionsByAuth<T extends { metadata?: Record<string, unknown> }>(
  sessions: readonly T[],
  auth: RequestAuth
): T[] {
  if (!auth.isolate || !auth.user) return [...sessions];
  return sessions.filter((s) => sessionOwnerId(s) === auth.user!.id);
}

export function stampOwnerMetadata(
  metadata: Record<string, unknown> | undefined,
  auth: RequestAuth
): Record<string, unknown> {
  const extra = { ...(metadata ?? {}) };
  if (!auth.user) return extra;
  extra.userId = auth.user.id;
  extra.tenantId = auth.user.tenantId;
  return extra;
}

export function requireAccessibleSession(
  session: SessionRecord | undefined,
  auth: RequestAuth
): SessionRecord {
  if (!session || !canAccessSession(session, auth)) {
    throw new NotFoundError('Session');
  }
  return session;
}

export function canAccessTask(
  task: TaskRecord,
  session: SessionRecord | undefined,
  auth: RequestAuth
): boolean {
  if (!auth.isolate || !auth.user) return true;
  const metaUser = typeof task.metadata?.userId === 'string' ? task.metadata.userId.trim() : '';
  if (metaUser && metaUser === auth.user.id) return true;
  if (session) return canAccessSession(session, auth);
  return false;
}

export function filterTasksByAuth(
  tasks: readonly TaskRecord[],
  sessionById: (id: string) => SessionRecord | undefined,
  auth: RequestAuth
): TaskRecord[] {
  if (!auth.isolate || !auth.user) return [...tasks];
  return tasks.filter((task) =>
    canAccessTask(task, task.sessionId ? sessionById(task.sessionId) : undefined, auth)
  );
}

export function publicAuthUser(user: AuthUser): AuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    tenantId: user.tenantId
  };
}
