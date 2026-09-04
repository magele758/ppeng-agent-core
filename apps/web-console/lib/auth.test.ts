import test from 'node:test';
import assert from 'node:assert/strict';
import { authErrorFromSearch, parseAuthMe } from './auth.ts';

test('parseAuthMe reads providers and user', () => {
  const me = parseAuthMe({
    loginRequired: true,
    providers: ['google', 'github', 'nope'],
    user: { id: 'u1', displayName: 'Ada', tenantId: 'default' }
  });
  assert.equal(me.loginRequired, true);
  assert.deepEqual(me.providers, ['google', 'github']);
  assert.equal(me.user?.id, 'u1');
});

test('authErrorFromSearch only accepts denied|failed', () => {
  assert.equal(authErrorFromSearch('?auth_error=denied'), 'denied');
  assert.equal(authErrorFromSearch('auth_error=failed'), 'failed');
  assert.equal(authErrorFromSearch('?auth_error=other'), undefined);
});
