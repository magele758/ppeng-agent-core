import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStateStore } from '../dist/storage.js';
import {
  ANONYMOUS_AUTH,
  AuthStore,
  buildAuthorizeUrl,
  canAccessSession,
  filterSessionsByAuth,
  hashToken,
  oauthPublicConfig,
  stampOwnerMetadata,
  upsertUserFromOAuth
} from '../dist/auth/index.js';

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'oauth-'));
  return new SqliteStateStore(join(dir, 'state.db'));
}

test('oauthPublicConfig: loginRequired only when a provider pair is complete', () => {
  assert.deepEqual(oauthPublicConfig({}), { loginRequired: false, providers: [] });
  assert.equal(
    oauthPublicConfig({
      RAW_AGENT_OAUTH_GOOGLE_CLIENT_ID: 'id',
      RAW_AGENT_OAUTH_GOOGLE_CLIENT_SECRET: 'secret'
    }).loginRequired,
    true
  );
  assert.deepEqual(
    oauthPublicConfig({ RAW_AGENT_OAUTH_GOOGLE_CLIENT_ID: 'id-only' }).providers,
    []
  );
});

test('buildAuthorizeUrl: google includes PKCE, github includes user email scope', () => {
  const google = buildAuthorizeUrl({
    provider: { id: 'google', clientId: 'g-id', clientSecret: 'g-sec' },
    redirectUri: 'http://127.0.0.1:33815/api/auth/google/callback',
    state: 'st',
    codeChallenge: 'chal'
  });
  assert.match(google, /accounts\.google\.com/);
  assert.match(google, /code_challenge=chal/);
  const github = buildAuthorizeUrl({
    provider: { id: 'github', clientId: 'gh-id', clientSecret: 'gh-sec' },
    redirectUri: 'http://127.0.0.1:33815/api/auth/github/callback',
    state: 'st'
  });
  assert.match(github, /github\.com\/login\/oauth\/authorize/);
  assert.match(github, /user%3Aemail/);
});

test('upsertUserFromOAuth: same email links google then github', () => {
  const store = tempStore();
  const memory = store.agentMemory();
  const auth = new AuthStore(store.db);
  const first = upsertUserFromOAuth({
    memory,
    auth,
    profile: {
      provider: 'google',
      providerUserId: 'g1',
      email: 'a@example.com',
      displayName: 'Ada'
    },
    env: { RAW_AGENT_DEFAULT_TENANT_ID: 't1' }
  });
  const second = upsertUserFromOAuth({
    memory,
    auth,
    profile: {
      provider: 'github',
      providerUserId: '42',
      email: 'a@example.com',
      displayName: 'ada-gh'
    },
    env: { RAW_AGENT_DEFAULT_TENANT_ID: 't1' }
  });
  assert.equal(first.id, second.id);
  assert.ok(auth.getIdentity('google', 'g1'));
  assert.ok(auth.getIdentity('github', '42'));
  store.db.close();
});

test('auth sessions: hash lookup then expiry purge', () => {
  const store = tempStore();
  const auth = new AuthStore(store.db);
  const token = 'plain-session-token';
  auth.createAuthSession({
    tokenHash: hashToken(token),
    userId: 'user_1',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: new Date().toISOString()
  });
  assert.equal(auth.getAuthSession(hashToken(token))?.userId, 'user_1');
  auth.deleteAuthSession(hashToken(token));
  assert.equal(auth.getAuthSession(hashToken(token)), undefined);
  store.db.close();
});

test('filterSessionsByAuth hides other owners when isolating', () => {
  const auth = {
    isolate: true,
    labProxy: true,
    user: { id: 'u1', tenantId: 'default' }
  };
  const sessions = [
    { id: 'a', metadata: { userId: 'u1' } },
    { id: 'b', metadata: { userId: 'u2' } },
    { id: 'c', metadata: {} }
  ];
  assert.deepEqual(
    filterSessionsByAuth(sessions, auth).map((s) => s.id),
    ['a']
  );
  assert.equal(canAccessSession(sessions[1], auth), false);
  assert.equal(canAccessSession(sessions[0], ANONYMOUS_AUTH), true);
  assert.deepEqual(stampOwnerMetadata({ title: 'x' }, auth).userId, 'u1');
});
