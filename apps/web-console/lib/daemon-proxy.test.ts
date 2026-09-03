import assert from 'node:assert/strict';
import { test } from 'node:test';
import { daemonProxyErrorMessage, sanitizeProxyHeaders } from './daemon-proxy.ts';

test('sanitizeProxyHeaders drops hop-by-hop and keeps content-type', () => {
  const src = new Headers({
    host: '127.0.0.1:33815',
    connection: 'keep-alive',
    'content-length': '12',
    'content-type': 'application/json',
    authorization: 'Bearer x'
  });
  const out = sanitizeProxyHeaders(src);
  assert.equal(out.get('content-type'), 'application/json');
  assert.equal(out.get('authorization'), 'Bearer x');
  assert.equal(out.get('host'), null);
  assert.equal(out.get('connection'), null);
  assert.equal(out.get('content-length'), null);
});

test('daemonProxyErrorMessage includes cause', () => {
  const err = new Error('fetch failed');
  err.cause = new Error('other side closed');
  assert.equal(daemonProxyErrorMessage(err), 'fetch failed (other side closed)');
});
