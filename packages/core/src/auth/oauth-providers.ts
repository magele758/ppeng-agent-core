import { createHash, randomBytes } from 'node:crypto';
import type { OAuthProfile, OAuthProviderConfig, OAuthProviderId } from './types.js';

export type FetchLike = typeof fetch;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function oauthCallbackPath(provider: OAuthProviderId): string {
  switch (provider) {
    case 'google':
      return '/api/auth/google/callback';
    case 'github':
      return '/api/auth/github/callback';
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

export function buildAuthorizeUrl(params: {
  provider: OAuthProviderConfig;
  redirectUri: string;
  state: string;
  codeChallenge?: string;
}): string {
  const { provider, redirectUri, state, codeChallenge } = params;
  switch (provider.id) {
    case 'google': {
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.searchParams.set('client_id', provider.clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'openid email profile');
      url.searchParams.set('state', state);
      url.searchParams.set('access_type', 'online');
      url.searchParams.set('prompt', 'select_account');
      if (codeChallenge) {
        url.searchParams.set('code_challenge', codeChallenge);
        url.searchParams.set('code_challenge_method', 'S256');
      }
      return url.toString();
    }
    case 'github': {
      const url = new URL('https://github.com/login/oauth/authorize');
      url.searchParams.set('client_id', provider.clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('scope', 'read:user user:email');
      url.searchParams.set('state', state);
      return url.toString();
    }
    default: {
      const _exhaustive: never = provider.id;
      return _exhaustive;
    }
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return asRecord(JSON.parse(text) as unknown);
  } catch {
    return { _raw: text };
  }
}

export async function exchangeAuthorizationCode(params: {
  provider: OAuthProviderConfig;
  redirectUri: string;
  code: string;
  codeVerifier?: string;
  fetchImpl?: FetchLike;
}): Promise<string> {
  const fetchImpl = params.fetchImpl ?? fetch;
  switch (params.provider.id) {
    case 'google': {
      const body = new URLSearchParams({
        client_id: params.provider.clientId,
        client_secret: params.provider.clientSecret,
        redirect_uri: params.redirectUri,
        grant_type: 'authorization_code',
        code: params.code
      });
      if (params.codeVerifier) body.set('code_verifier', params.codeVerifier);
      const res = await fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body
      });
      const json = await readJson(res);
      const token = typeof json.access_token === 'string' ? json.access_token.trim() : '';
      if (!res.ok || !token) {
        throw new Error(
          typeof json.error_description === 'string'
            ? json.error_description
            : 'Google token exchange failed'
        );
      }
      return token;
    }
    case 'github': {
      const res = await fetchImpl('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          client_id: params.provider.clientId,
          client_secret: params.provider.clientSecret,
          redirect_uri: params.redirectUri,
          code: params.code
        })
      });
      const json = await readJson(res);
      const token = typeof json.access_token === 'string' ? json.access_token.trim() : '';
      if (!res.ok || !token) {
        throw new Error(typeof json.error_description === 'string' ? json.error_description : 'GitHub token exchange failed');
      }
      return token;
    }
    default: {
      const _exhaustive: never = params.provider.id;
      return _exhaustive;
    }
  }
}

export async function fetchOAuthProfile(params: {
  provider: OAuthProviderId;
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<OAuthProfile> {
  const fetchImpl = params.fetchImpl ?? fetch;
  switch (params.provider) {
    case 'google': {
      const res = await fetchImpl('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { authorization: `Bearer ${params.accessToken}` }
      });
      const json = await readJson(res);
      const id = typeof json.sub === 'string' ? json.sub.trim() : '';
      if (!res.ok || !id) throw new Error('Google userinfo failed');
      return {
        provider: 'google',
        providerUserId: id,
        email:
          json.email_verified === false
            ? undefined
            : typeof json.email === 'string'
              ? json.email.trim().toLowerCase()
              : undefined,
        displayName: typeof json.name === 'string' ? json.name.trim() : undefined,
        avatarUrl: typeof json.picture === 'string' ? json.picture.trim() : undefined
      };
    }
    case 'github': {
      const userRes = await fetchImpl('https://api.github.com/user', {
        headers: {
          authorization: `Bearer ${params.accessToken}`,
          accept: 'application/vnd.github+json',
          'user-agent': 'ppeng-agent-core'
        }
      });
      const user = await readJson(userRes);
      const id = user.id != null ? String(user.id).trim() : '';
      if (!userRes.ok || !id) throw new Error('GitHub userinfo failed');
      let email =
        typeof user.email === 'string' && user.email.trim() ? user.email.trim().toLowerCase() : undefined;
      if (!email) {
        const mailRes = await fetchImpl('https://api.github.com/user/emails', {
          headers: {
            authorization: `Bearer ${params.accessToken}`,
            accept: 'application/vnd.github+json',
            'user-agent': 'ppeng-agent-core'
          }
        });
        const mails = (await mailRes.json()) as unknown;
        if (Array.isArray(mails)) {
          const rows = mails.map((row) => asRecord(row));
          const primary = rows.find((row) => row.primary === true && row.verified === true);
          const verified = rows.find((row) => row.verified === true);
          const pick = primary ?? verified ?? rows[0];
          email = typeof pick?.email === 'string' ? pick.email.trim().toLowerCase() : undefined;
        }
      }
      return {
        provider: 'github',
        providerUserId: id,
        email,
        displayName:
          typeof user.name === 'string' && user.name.trim()
            ? user.name.trim()
            : typeof user.login === 'string'
              ? user.login.trim()
              : undefined,
        avatarUrl: typeof user.avatar_url === 'string' ? user.avatar_url.trim() : undefined
      };
    }
    default: {
      const _exhaustive: never = params.provider;
      return _exhaustive;
    }
  }
}
