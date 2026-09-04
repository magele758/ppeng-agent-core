import { createId, nowIso } from '../id.js';
import type { AgentMemoryStore } from '../memory/store.js';
import { defaultTenantIdFromEnv } from '../storage/provider-config.js';
import type { AuthStore } from './store.js';
import type { AuthUser, OAuthProfile } from './types.js';

function displayNameFrom(profile: OAuthProfile): string {
  const name = profile.displayName?.trim();
  if (name) return name;
  const email = profile.email?.trim();
  if (email) return email.split('@')[0] ?? email;
  return `${profile.provider}-${profile.providerUserId.slice(0, 8)}`;
}

export function upsertUserFromOAuth(params: {
  memory: AgentMemoryStore;
  auth: AuthStore;
  profile: OAuthProfile;
  env?: NodeJS.ProcessEnv;
}): AuthUser {
  const { memory, auth, profile } = params;
  const tenantId = defaultTenantIdFromEnv(params.env ?? process.env);
  const now = nowIso();
  const email = profile.email?.trim().toLowerCase() || undefined;

  const linked = auth.getIdentity(profile.provider, profile.providerUserId);
  let userId = linked?.userId;
  if (!userId && email) {
    userId = memory.getUserByEmail(email)?.id;
  }

  if (!userId) {
    userId = createId('user');
    memory.upsertUser({
      id: userId,
      email,
      displayName: displayNameFrom(profile),
      avatarUrl: profile.avatarUrl,
      status: 'active',
      createdAt: now
    });
  } else {
    const existing = memory.getUser(userId);
    memory.upsertUser({
      id: userId,
      email: email ?? existing?.email,
      displayName: profile.displayName?.trim() || existing?.displayName,
      avatarUrl: profile.avatarUrl ?? existing?.avatarUrl,
      status: existing?.status ?? 'active',
      createdAt: existing?.createdAt ?? now
    });
  }

  memory.upsertTenant({ id: tenantId, name: 'Default', createdAt: now });
  memory.addMembership({ userId, tenantId, role: 'member' });
  auth.linkIdentity({
    provider: profile.provider,
    providerUserId: profile.providerUserId,
    userId,
    email,
    createdAt: now
  });

  const saved = memory.getUser(userId);
  return {
    id: userId,
    email: saved?.email,
    displayName: saved?.displayName,
    avatarUrl: saved?.avatarUrl,
    tenantId
  };
}

export function authUserFromId(memory: AgentMemoryStore, userId: string, env?: NodeJS.ProcessEnv): AuthUser | null {
  const user = memory.getUser(userId);
  if (!user || user.status !== 'active') return null;
  const tenantId =
    memory.getMemberships(userId)[0]?.tenantId ?? defaultTenantIdFromEnv(env ?? process.env);
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    tenantId
  };
}
