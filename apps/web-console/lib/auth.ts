export type AuthProviderId = 'google' | 'github';

export type AuthUser = {
  id: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  tenantId: string;
};

export type AuthMeResponse = {
  loginRequired: boolean;
  providers: AuthProviderId[];
  user: AuthUser | null;
};

export function parseAuthMe(data: unknown): AuthMeResponse {
  const row = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const providers = Array.isArray(row.providers)
    ? row.providers.filter((id): id is AuthProviderId => id === 'google' || id === 'github')
    : [];
  const userRaw = row.user && typeof row.user === 'object' ? (row.user as Record<string, unknown>) : null;
  const user =
    userRaw && typeof userRaw.id === 'string'
      ? {
          id: userRaw.id,
          email: typeof userRaw.email === 'string' ? userRaw.email : undefined,
          displayName: typeof userRaw.displayName === 'string' ? userRaw.displayName : undefined,
          avatarUrl: typeof userRaw.avatarUrl === 'string' ? userRaw.avatarUrl : undefined,
          tenantId: typeof userRaw.tenantId === 'string' ? userRaw.tenantId : 'default'
        }
      : null;
  return {
    loginRequired: row.loginRequired === true,
    providers,
    user
  };
}

export function authErrorFromSearch(search: string): 'denied' | 'failed' | undefined {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const raw = params.get('auth_error');
  if (raw === 'denied' || raw === 'failed') return raw;
  return undefined;
}
