import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { maybeExportOtelSpan } from '../dist/otel.js';

function makeTempDir() {
  const dir = join(
    tmpdir(),
    'ppeng-otel-test-' + Date.now() + '-' + Math.random().toString(36).slice(2)
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('maybeExportOtelSpan', () => {
  let stateDir;

  before(() => {
    stateDir = makeTempDir();
  });

  after(() => {
    try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ── No-op path (no endpoint configured) ──

  it('returns without error when endpoint is not set', async () => {
    await maybeExportOtelSpan(
      {},
      stateDir,
      'sess-noop',
      'test-span',
      { key: 'val' }
    );
    // Should resolve without throwing
  });

  it('returns without error when endpoint is empty string', async () => {
    await maybeExportOtelSpan(
      { RAW_AGENT_OTEL_HTTP_ENDPOINT: '' },
      stateDir,
      'sess-empty-ep',
      'test-span',
      { foo: 'bar' }
    );
  });

  it('returns without error when endpoint is whitespace only', async () => {
    await maybeExportOtelSpan(
      { RAW_AGENT_OTEL_HTTP_ENDPOINT: '   ' },
      stateDir,
      'sess-ws',
      'test-span',
      {}
    );
  });

  it('no trace file is written when endpoint is unset', async () => {
    await maybeExportOtelSpan(
      {},
      stateDir,
      'sess-no-trace',
      'test-span',
      { a: 'b' }
    );
    const traceFile = join(stateDir, 'traces', 'sess-no-trace', 'events.jsonl');
    assert.strictEqual(existsSync(traceFile), false);
  });

  // ── With endpoint set (HTTP will fail silently) ──

  it('does not throw when collector is unreachable', async () => {
    await maybeExportOtelSpan(
      { RAW_AGENT_OTEL_HTTP_ENDPOINT: 'http://127.0.0.1:19999/v1/traces' },
      stateDir,
      'sess-fail',
      'test-span',
      { k: 'v' }
    );
    // fetch failure is silently caught
  });

  // appendTraceEvent is fire-and-forget (void), so we wait briefly for the write
  const tick = (ms) => new Promise((r) => setTimeout(r, ms));

  it('writes trace event when endpoint is configured', async () => {
    await maybeExportOtelSpan(
      { RAW_AGENT_OTEL_HTTP_ENDPOINT: 'http://127.0.0.1:19999/v1/traces' },
      stateDir,
      'sess-trace',
      'my-span',
      { region: 'us-east' }
    );
    await tick(200);
    const traceFile = join(stateDir, 'traces', 'sess-trace', 'events.jsonl');
    assert.ok(existsSync(traceFile), 'trace event file should be created');
    const lines = readFileSync(traceFile, 'utf8').trim().split('\n');
    assert.ok(lines.length >= 1);
    const event = JSON.parse(lines[0]);
    assert.strictEqual(event.kind, 'otel_proxy');
    assert.strictEqual(event.sessionId, 'sess-trace');
    assert.strictEqual(event.payload.name, 'my-span');
    assert.strictEqual(event.payload.endpoint, 'http://127.0.0.1:19999/v1/traces');
    assert.ok(event.ts, 'should have a timestamp');
  });

  it('handles empty attributes object', async () => {
    await maybeExportOtelSpan(
      { RAW_AGENT_OTEL_HTTP_ENDPOINT: 'http://127.0.0.1:19999/v1/traces' },
      stateDir,
      'sess-empty-attrs',
      'span-empty',
      {}
    );
    await tick(200);
    const traceFile = join(stateDir, 'traces', 'sess-empty-attrs', 'events.jsonl');
    assert.ok(existsSync(traceFile));
  });

  it('handles span name with special characters', async () => {
    await maybeExportOtelSpan(
      { RAW_AGENT_OTEL_HTTP_ENDPOINT: 'http://127.0.0.1:19999/v1/traces' },
      stateDir,
      'sess-special',
      'span/with:special.chars',
      { 'key.with.dots': 'val/slash' }
    );
    await tick(200);
    const traceFile = join(stateDir, 'traces', 'sess-special', 'events.jsonl');
    const event = JSON.parse(readFileSync(traceFile, 'utf8').trim());
    assert.strictEqual(event.payload.name, 'span/with:special.chars');
  });
});
