export const LAB_PROXY_HEADER = 'x-ppeng-lab';
export const AUTH_SESSION_COOKIE = 'ppeng_lab_session';
export const AUTH_OAUTH_STATE_COOKIE = 'ppeng_oauth_state';

export type OAuthProviderId = 'google' | 'github';

export type OAuthProviderConfig = {
  id: OAuthProviderId;
  clientId: string;
  clientSecret: string;
};

export type OAuthPublicConfig = {
  loginRequired: boolean;
  providers: OAuthProviderId[];
};

export type AuthUser = {
  id: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  tenantId: string;
};

export type RequestAuth = {
  /** True when this request must only see the signed-in user's rows. */
  isolate: boolean;
  /** True when the call arrived via Lab Next proxy (browser), not CLI/god-mode. */
  labProxy: boolean;
  user: AuthUser | null;
};

export type OAuthProfile = {
  provider: OAuthProviderId;
  providerUserId: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
};

export type OAuthStateRow = {
  state: string;
  provider: OAuthProviderId;
  codeVerifier?: string;
  redirectTo?: string;
  expiresAt: string;
  createdAt: string;
};

export type AuthSessionRow = {
  tokenHash: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
};

export type OAuthIdentityRow = {
  provider: OAuthProviderId;
  providerUserId: string;
  userId: string;
  email?: string;
  createdAt: string;
};
