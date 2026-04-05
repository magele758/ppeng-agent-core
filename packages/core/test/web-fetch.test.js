import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchUrlText } from '../dist/tools/web-fetch.js';

// ── SSRF guard (isPrivateIp tested indirectly via fetchUrlText) ──

test('fetchUrlText blocks localhost', async () => {
  const result = await fetchUrlText({ url: 'http://localhost/secret' });
  assert.equal(result.ok, false);
  assert.ok(result.content.includes('private'));
});

test('fetchUrlText blocks 127.0.0.1', async () => {
  const result = await fetchUrlText({ url: 'http://127.0.0.1/secret' });
  assert.equal(result.ok, false);
  assert.ok(result.content.includes('private'));
});

test('fetchUrlText blocks 10.x.x.x', async () => {
  const result = await fetchUrlText({ url: 'http://10.0.0.1/admin' });
  assert.equal(result.ok, false);
  assert.ok(result.content.includes('private'));
});

test('fetchUrlText blocks 192.168.x.x', async () => {
  const result = await fetchUrlText({ url: 'http://192.168.1.1/' });
  assert.equal(result.ok, false);
  assert.ok(result.content.includes('private'));
});

test('fetchUrlText blocks 172.16-31.x.x', async () => {
  const result = await fetchUrlText({ url: 'http://172.16.0.1/' });
  assert.equal(result.ok, false);
  assert.ok(result.content.includes('private'));
});

test('fetchUrlText blocks 169.254.x.x (link-local)', async () => {
  const result = await fetchUrlText({ url: 'http://169.254.169.254/metadata' });
  assert.equal(result.ok, false);
  assert.ok(result.content.includes('private'));
});

test('fetchUrlText blocks 0.0.0.0', async () => {
  const result = await fetchUrlText({ url: 'http://0.0.0.0/' });
  assert.equal(result.ok, false);
  assert.ok(result.content.includes('private'));
});

test('fetchUrlText blocks IPv6 loopback ::1', async () => {
  const result = await fetchUrlText({ url: 'http://[::1]/' });
  assert.equal(result.ok, false);
  assert.ok(result.content.includes('private'));
});

test('fetchUrlText allows private hosts when allowPrivateHosts=true', async () => {
  // This will fail to connect but NOT be blocked by SSRF guard
  const result = await fetchUrlText({ url: 'http://127.0.0.1:19999/', allowPrivateHosts: true, timeoutMs: 500 });
  // Should get a connection/fetch error, not a "private" rejection
  assert.equal(result.ok, false);
  assert.ok(!result.content.includes('private'));
});

// ── URL validation ──

test('fetchUrlText rejects invalid URL', async () => {
  const result = await fetchUrlText({ url: 'not-a-url' });
  assert.equal(result.ok, false);
  assert.ok(result.content.includes('Invalid URL'));
});

test('fetchUrlText rejects non-http protocols', async () => {
  const result = await fetchUrlText({ url: 'ftp://example.com/file' });
  assert.equal(result.ok, false);
  assert.ok(result.content.includes('http(s)'));
});

test('fetchUrlText rejects file:// protocol', async () => {
  const result = await fetchUrlText({ url: 'file:///etc/passwd' });
  assert.equal(result.ok, false);
  assert.ok(result.content.includes('http(s)'));
});

// ── 172.x edge cases ──

test('fetchUrlText allows 172.15.x.x (not in private range)', async () => {
  // 172.15 is NOT private (only 172.16-31 is private)
  // This will fail to connect but should NOT be blocked by SSRF
  const result = await fetchUrlText({ url: 'http://172.15.0.1:19999/', timeoutMs: 500 });
  assert.equal(result.ok, false);
  assert.ok(!result.content.includes('private'));
});

test('fetchUrlText blocks 172.31.x.x (top of private range)', async () => {
  const result = await fetchUrlText({ url: 'http://172.31.255.255/' });
  assert.equal(result.ok, false);
  assert.ok(result.content.includes('private'));
});

test('fetchUrlText allows 172.32.x.x (above private range)', async () => {
  const result = await fetchUrlText({ url: 'http://172.32.0.1:19999/', timeoutMs: 500 });
  assert.equal(result.ok, false);
  assert.ok(!result.content.includes('private'));
});
