import type { DatabaseSync } from 'node:sqlite';
import { nowIso } from '../id.js';
import type { OAuthIdentityRow, OAuthProviderId, OAuthStateRow, AuthSessionRow } from './types.js';

function mapIdentity(row: Record<string, unknown>): OAuthIdentityRow {
  return {
    provider: String(row.provider) as OAuthProviderId,
    providerUserId: String(row.provider_user_id),
    userId: String(row.user_id),
    email: row.email != null ? String(row.email) : undefined,
    createdAt: String(row.created_at)
  };
}

function mapState(row: Record<string, unknown>): OAuthStateRow {
  return {
    state: String(row.state),
    provider: String(row.provider) as OAuthProviderId,
    codeVerifier: row.code_verifier != null ? String(row.code_verifier) : undefined,
    redirectTo: row.redirect_to != null ? String(row.redirect_to) : undefined,
    expiresAt: String(row.expires_at),
    createdAt: String(row.created_at)
  };
}

function mapSession(row: Record<string, unknown>): AuthSessionRow {
  return {
    tokenHash: String(row.token_hash),
    userId: String(row.user_id),
    expiresAt: String(row.expires_at),
    createdAt: String(row.created_at)
  };
}

export class AuthStore {
  constructor(private readonly db: DatabaseSync) {}

  putOAuthState(row: OAuthStateRow): void {
    this.db
      .prepare(
        `INSERT INTO oauth_states (state, provider, code_verifier, redirect_to, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.state,
        row.provider,
        row.codeVerifier ?? null,
        row.redirectTo ?? null,
        row.expiresAt,
        row.createdAt
      );
  }

  takeOAuthState(state: string): OAuthStateRow | undefined {
    const row = this.db.prepare(`SELECT * FROM oauth_states WHERE state = ?`).get(state) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    this.db.prepare(`DELETE FROM oauth_states WHERE state = ?`).run(state);
    const parsed = mapState(row);
    if (Date.parse(parsed.expiresAt) <= Date.now()) return undefined;
    return parsed;
  }

  purgeExpired(): void {
    const now = nowIso();
    this.db.prepare(`DELETE FROM oauth_states WHERE expires_at <= ?`).run(now);
    this.db.prepare(`DELETE FROM auth_sessions WHERE expires_at <= ?`).run(now);
  }

  getIdentity(provider: OAuthProviderId, providerUserId: string): OAuthIdentityRow | undefined {
    const row = this.db
      .prepare(`SELECT * FROM oauth_identities WHERE provider = ? AND provider_user_id = ?`)
      .get(provider, providerUserId) as Record<string, unknown> | undefined;
    return row ? mapIdentity(row) : undefined;
  }

  linkIdentity(row: OAuthIdentityRow): void {
    this.db
      .prepare(
        `INSERT INTO oauth_identities (provider, provider_user_id, user_id, email, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(provider, provider_user_id) DO UPDATE SET
           user_id = excluded.user_id,
           email = excluded.email`
      )
      .run(row.provider, row.providerUserId, row.userId, row.email ?? null, row.createdAt);
  }

  createAuthSession(row: AuthSessionRow): void {
    this.db
      .prepare(
        `INSERT INTO auth_sessions (token_hash, user_id, expires_at, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(row.tokenHash, row.userId, row.expiresAt, row.createdAt);
  }

  getAuthSession(tokenHash: string): AuthSessionRow | undefined {
    const row = this.db.prepare(`SELECT * FROM auth_sessions WHERE token_hash = ?`).get(tokenHash) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    const parsed = mapSession(row);
    if (Date.parse(parsed.expiresAt) <= Date.now()) {
      this.deleteAuthSession(tokenHash);
      return undefined;
    }
    return parsed;
  }

  deleteAuthSession(tokenHash: string): void {
    this.db.prepare(`DELETE FROM auth_sessions WHERE token_hash = ?`).run(tokenHash);
  }

  deleteUserAuthSessions(userId: string): void {
    this.db.prepare(`DELETE FROM auth_sessions WHERE user_id = ?`).run(userId);
  }
}
