import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendBoundedLog,
  electronNodeEnv,
  formatChildFailure,
  sanitizeProcessEnv,
  tailLines,
  waitForHttpOk
} from './launch-utils.ts';

test('sanitizeProcessEnv drops undefined and non-string values', () => {
  const cleaned = sanitizeProcessEnv({
    KEEP: 'yes',
    EMPTY: '',
    DROP: undefined,
    // Electron typings allow only string | undefined; coerce a bad value
    BAD: 1 as unknown as string
  });
  assert.deepEqual(cleaned, { KEEP: 'yes', EMPTY: '' });
});

test('electronNodeEnv forces ELECTRON_RUN_AS_NODE last', () => {
  const env = electronNodeEnv({ PATH: '/bin', ELECTRON_RUN_AS_NODE: '0' }, {
    RAW_AGENT_DAEMON_PORT: '37070',
    ELECTRON_RUN_AS_NODE: '0'
  });
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(env.RAW_AGENT_DAEMON_PORT, '37070');
  assert.equal(env.PATH, '/bin');
});

test('formatChildFailure includes log tail when the process died', () => {
  const err = formatChildFailure({
    name: 'Daemon',
    url: 'http://127.0.0.1:37070/api/health',
    exitCode: 1,
    logs: 'schema migration v4 failed: no such module: fts5\n'
  });
  assert.match(err.message, /Daemon exited before becoming healthy \(code 1\)/);
  assert.match(err.message, /no such module: fts5/);
});

test('formatChildFailure reports timeout without claiming an exit', () => {
  const err = formatChildFailure({
    name: 'Daemon',
    url: 'http://127.0.0.1:37070/api/health',
    exitCode: null,
    logs: 'still starting\n'
  });
  assert.match(err.message, /Daemon health check timeout \(http:\/\/127\.0\.0\.1:37070\/api\/health\)/);
  assert.doesNotMatch(err.message, /exited before becoming healthy/);
});

test('appendBoundedLog and tailLines keep the newest text', () => {
  assert.equal(appendBoundedLog('abcd', 'ef', 5), 'bcdef');
  assert.equal(tailLines('a\n\nb\nc\n', 2), 'b\nc');
});

test('waitForHttpOk returns when status is acceptable', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { status: 200 } as Response;
  };
  await waitForHttpOk({
    url: 'http://127.0.0.1:9/api/health',
    maxAttempts: 3,
    intervalMs: 1,
    initialDelayMs: 0,
    requestTimeoutMs: 20,
    fetchImpl
  });
  assert.equal(calls, 1);
});

test('waitForHttpOk fails fast when the child already exited', async () => {
  await assert.rejects(
    () =>
      waitForHttpOk({
        url: 'http://127.0.0.1:9/api/health',
        maxAttempts: 30,
        intervalMs: 1,
        initialDelayMs: 0,
        requestTimeoutMs: 20,
        fetchImpl: async () => {
          throw new Error('should not fetch');
        },
        shouldAbort: () => new Error('Daemon exited before becoming healthy (code 1)')
      }),
    /exited before becoming healthy/
  );
});

test('waitForHttpOk times out after maxAttempts', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      waitForHttpOk({
        url: 'http://127.0.0.1:9/api/health',
        maxAttempts: 3,
        intervalMs: 1,
        initialDelayMs: 0,
        requestTimeoutMs: 20,
        fetchImpl: async () => {
          calls += 1;
          throw new Error('connection refused');
        },
        sleep: async () => undefined
      }),
    /Health check timeout/
  );
  assert.equal(calls, 3);
});
