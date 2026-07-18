import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectRedactionTargets,
  redactEnvValues,
  redactToolContent,
  REDACT_MIN_VALUE_LENGTH
} from '../dist/sandbox/result-redaction.js';

test('collectRedactionTargets picks API keys and skips short/exempt', () => {
  const targets = collectRedactionTargets({
    PATH: '/usr/bin',
    RAW_AGENT_API_KEY: 'sk-live-secret-value-12345',
    SHORT: 'abc',
    MY_TOKEN: 'tok_abcdefghijklmnopqrstuvwxyz',
    HARMLESS_FLAG: 'enabled-ok'
  });
  const names = targets.map(([n]) => n);
  assert.ok(names.includes('RAW_AGENT_API_KEY'));
  assert.ok(names.includes('MY_TOKEN'));
  assert.ok(!names.includes('PATH'));
  assert.ok(!names.includes('SHORT'));
  assert.ok(!names.includes('HARMLESS_FLAG'));
});

test('redactEnvValues replaces secret substrings in nested structures', () => {
  const secret = 'super-secret-cookie-value';
  const env = { SHM_SANDBOX_COOKIE: secret, PATH: '/bin' };
  const out = redactEnvValues(
    {
      stdout: `cookie=${secret}`,
      nested: [`pre ${secret} post`, { msg: secret }]
    },
    env
  );
  assert.equal(out.stdout, 'cookie=[REDACTED:SHM_SANDBOX_COOKIE]');
  assert.equal(out.nested[0], 'pre [REDACTED:SHM_SANDBOX_COOKIE] post');
  assert.equal(out.nested[1].msg, '[REDACTED:SHM_SANDBOX_COOKIE]');
});

test('redactEnvValues no-ops when no targets', () => {
  assert.equal(redactEnvValues('hello', { PATH: '/bin' }), 'hello');
});

test('redactToolContent is string convenience', () => {
  const key = 'x'.repeat(REDACT_MIN_VALUE_LENGTH + 2);
  const out = redactToolContent(`leak ${key}`, { RAW_AGENT_API_KEY: key });
  assert.equal(out, 'leak [REDACTED:RAW_AGENT_API_KEY]');
});

test('longer secrets redacted before shorter overlapping ones', () => {
  const long = 'abcdefghijklmnop';
  const short = 'abcdef';
  const out = redactEnvValues(`xx${long}yy`, {
    LONG_SECRET: long,
    SHORT_SECRET: short
  });
  assert.equal(out, 'xx[REDACTED:LONG_SECRET]yy');
});
