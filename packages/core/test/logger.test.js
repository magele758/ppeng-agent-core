import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, setLogLevel, resetLogLevel } from '../dist/logger.js';

test('createLogger returns object with debug/info/warn/error', () => {
  const log = createLogger('test');
  assert.equal(typeof log.debug, 'function');
  assert.equal(typeof log.info, 'function');
  assert.equal(typeof log.warn, 'function');
  assert.equal(typeof log.error, 'function');
});

test('logger respects log level: silent suppresses all', (t) => {
  setLogLevel('silent');
  t.after(() => resetLogLevel());
  const log = createLogger('test');
  // Should not throw even when level is silent
  log.debug('debug msg');
  log.info('info msg');
  log.warn('warn msg');
  log.error('error msg');
});

test('logger respects log level: error only', (t) => {
  setLogLevel('error');
  t.after(() => resetLogLevel());
  const log = createLogger('test');
  // Capture console.error output
  const calls = [];
  const orig = console.error;
  console.error = (...args) => calls.push(args);
  t.after(() => { console.error = orig; });

  log.debug('d');
  log.info('i');
  log.warn('w');
  log.error('e');

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['[test]', 'e']);
});

test('logger respects log level: debug shows all', (t) => {
  setLogLevel('debug');
  t.after(() => resetLogLevel());
  const log = createLogger('ns');

  const calls = { debug: [], log: [], warn: [], error: [] };
  const origD = console.debug;
  const origL = console.log;
  const origW = console.warn;
  const origE = console.error;
  console.debug = (...a) => calls.debug.push(a);
  console.log = (...a) => calls.log.push(a);
  console.warn = (...a) => calls.warn.push(a);
  console.error = (...a) => calls.error.push(a);
  t.after(() => {
    console.debug = origD;
    console.log = origL;
    console.warn = origW;
    console.error = origE;
  });

  log.debug('d');
  log.info('i');
  log.warn('w');
  log.error('e');

  assert.equal(calls.debug.length, 1);
  assert.equal(calls.log.length, 1);
  assert.equal(calls.warn.length, 1);
  assert.equal(calls.error.length, 1);
});

test('setLogLevel and resetLogLevel', () => {
  setLogLevel('warn');
  resetLogLevel();
  // After reset, falls back to env (default info)
  const log = createLogger('t');
  const calls = [];
  const orig = console.log;
  console.log = (...a) => calls.push(a);
  log.info('should show at info level');
  console.log = orig;
  assert.equal(calls.length, 1);
});

test('JSON mode emits one NDJSON line per call (info → stdout, error → stderr)', (t) => {
  setLogLevel('debug');
  process.env.RAW_AGENT_LOG_FORMAT = 'json';
  t.after(() => {
    delete process.env.RAW_AGENT_LOG_FORMAT;
    resetLogLevel();
  });

  const stdoutChunks = [];
  const stderrChunks = [];
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  // Cast through `any` for the reassignment — node:test forbids ts-ignore but
  // jsdoc has no convenient escape; the test file is plain JS.
  process.stdout.write = (chunk) => { stdoutChunks.push(String(chunk)); return true; };
  process.stderr.write = (chunk) => { stderrChunks.push(String(chunk)); return true; };
  t.after(() => {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  });

  const log = createLogger('jsonNs');
  log.info('hello world', { runId: 'abc' });
  log.error('boom', new Error('failed badly'));

  assert.equal(stdoutChunks.length, 1, 'info goes to stdout');
  assert.equal(stderrChunks.length, 1, 'error goes to stderr');
  const infoLine = JSON.parse(stdoutChunks[0]);
  assert.equal(infoLine.level, 'info');
  assert.equal(infoLine.ns, 'jsonNs');
  assert.equal(infoLine.msg, 'hello world');
  assert.deepEqual(infoLine.extra, [{ runId: 'abc' }]);

  const errLine = JSON.parse(stderrChunks[0]);
  assert.equal(errLine.level, 'error');
  assert.equal(errLine.msg, 'boom failed badly');
  assert.equal(errLine.extra[0].error.name, 'Error');
  assert.match(errLine.extra[0].error.stack, /failed badly/);
});
