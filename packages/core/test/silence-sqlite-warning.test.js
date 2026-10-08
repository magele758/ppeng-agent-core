import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { sanitizeSpawnEnv } from '../dist/sandbox/env-sanitizer.js';

const filterUrl = new URL('../dist/silence-sqlite-warning.js', import.meta.url).href;

// The module owns process listeners. Exercise it in a fresh process, with
// explicit warning events rather than relying on a Node version to emit one.
function runFilter(warnings, keep = '') {
  const env = sanitizeSpawnEnv();
  env.RAW_AGENT_KEEP_SQLITE_WARNING = keep;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    process.removeAllListeners('warning');
    const original = (warning) => process.stderr.write('original:' + warning.message + '\\n');
    process.on('warning', original);
    await import(${JSON.stringify(filterUrl)});
    for (const warning of ${JSON.stringify(warnings)}) process.emit('warning', warning);
    console.log(JSON.stringify({ originalKept: process.listeners('warning').includes(original) }));
  `], { env, encoding: 'utf8', timeout: 5_000 });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
  return { ...JSON.parse(child.stdout), stderr: child.stderr };
}

test('warning filter: SQLite experimental warnings alone are suppressed', () => {
  const result = runFilter([
    { name: 'ExperimentalWarning', message: 'SQLite is an experimental feature', stack: 'hidden stack' },
    { name: 'ExperimentalWarning', message: 'sqlite changed', stack: 'hidden stack' }
  ]);
  assert.equal(result.originalKept, false);
  assert.equal(result.stderr, '');
});

test('warning filter: non-SQLite warnings preserve name, code, message and stack', () => {
  const result = runFilter([
    { name: 'ExperimentalWarning', message: 'other experimental feature', stack: 'other-stack' },
    { name: 'Warning', code: 'CUSTOM_1', message: 'SQLite connection failed', stack: 'failure-stack' }
  ]);
  assert.match(result.stderr, /\(node:\d+\) ExperimentalWarning: other experimental feature\nother-stack\n/);
  assert.match(result.stderr, /\(node:\d+\) Warning \[CUSTOM_1\]: SQLite connection failed\nfailure-stack\n/);
  assert.doesNotMatch(result.stderr, /original:/);
});

test('warning filter: deprecations omit stack; nameless and message-less warnings remain printable', () => {
  const result = runFilter([
    { name: 'DeprecationWarning', code: 'DEP_TEST', message: 'deprecated', stack: 'not-printed' },
    { message: 'nameless warning' },
    { name: 'ExperimentalWarning' }
  ]);
  assert.match(result.stderr, /DeprecationWarning \[DEP_TEST\]: deprecated\n/);
  assert.doesNotMatch(result.stderr, /not-printed/);
  assert.match(result.stderr, /Warning: nameless warning\n/);
  assert.match(result.stderr, /ExperimentalWarning: undefined\n/);
});

for (const keep of ['1', 'true', 'yes', 'TrUe']) {
  test(`warning filter: opt-out ${keep} preserves existing listeners`, () => {
    const result = runFilter([{ name: 'ExperimentalWarning', message: 'SQLite notice' }], keep);
    assert.equal(result.originalKept, true);
    assert.equal(result.stderr, 'original:SQLite notice\n');
  });
}

test('warning filter: false opt-out still installs the filter', () => {
  assert.equal(runFilter([{ name: 'ExperimentalWarning', message: 'SQLite notice' }], '0').stderr, '');
});
