import type { OAuthProviderConfig, OAuthProviderId, OAuthPublicConfig } from './types.js';

function pair(
  env: NodeJS.ProcessEnv,
  id: OAuthProviderId,
  idKey: string,
  secretKey: string
): OAuthProviderConfig | undefined {
  const clientId = String(env[idKey] ?? '').trim();
  const clientSecret = String(env[secretKey] ?? '').trim();
  if (!clientId || !clientSecret) return undefined;
  return { id, clientId, clientSecret };
}

export function oauthProvidersFromEnv(env: NodeJS.ProcessEnv = process.env): OAuthProviderConfig[] {
  const out: OAuthProviderConfig[] = [];
  const google = pair(
    env,
    'google',
    'RAW_AGENT_OAUTH_GOOGLE_CLIENT_ID',
    'RAW_AGENT_OAUTH_GOOGLE_CLIENT_SECRET'
  );
  const github = pair(
    env,
    'github',
    'RAW_AGENT_OAUTH_GITHUB_CLIENT_ID',
    'RAW_AGENT_OAUTH_GITHUB_CLIENT_SECRET'
  );
  if (google) out.push(google);
  if (github) out.push(github);
  return out;
}

export function oauthProvider(
  env: NodeJS.ProcessEnv,
  id: OAuthProviderId
): OAuthProviderConfig | undefined {
  return oauthProvidersFromEnv(env).find((p) => p.id === id);
}

export function oauthPublicConfig(env: NodeJS.ProcessEnv = process.env): OAuthPublicConfig {
  const providers = oauthProvidersFromEnv(env).map((p) => p.id);
  return { loginRequired: providers.length > 0, providers };
}

export function oauthPublicOrigin(env: NodeJS.ProcessEnv, fallbackHost?: string): string {
  const explicit = String(env.RAW_AGENT_OAUTH_PUBLIC_ORIGIN ?? '')
    .trim()
    .replace(/\/$/, '');
  if (explicit) return explicit;
  const host = (fallbackHost ?? '').trim();
  if (!host) return '';
  return host.includes('://') ? host.replace(/\/$/, '') : `http://${host}`;
}
