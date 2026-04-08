import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readSessionTraceEvents } from '../dist/stores/read-traces.js';

const TMP = join(import.meta.dirname, '..', '.tmp-test-read-traces-' + process.pid);

describe('readSessionTraceEvents', () => {
  before(() => mkdirSync(TMP, { recursive: true }));
  after(() => rmSync(TMP, { recursive: true, force: true }));

  function writeTraceFile(sessionId, content) {
    const dir = join(TMP, 'traces', sessionId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'events.jsonl'), content, 'utf8');
  }

  it('parses valid JSONL lines', async () => {
    const events = [
      { kind: 'tool_call', ts: '2024-01-01T00:00:00Z' },
      { kind: 'model_response', ts: '2024-01-01T00:00:01Z' }
    ];
    writeTraceFile('s1', events.map(e => JSON.stringify(e)).join('\n'));
    const result = await readSessionTraceEvents(TMP, 's1');
    assert.equal(result.length, 2);
    assert.equal(result[0].kind, 'tool_call');
    assert.equal(result[1].kind, 'model_response');
  });

  it('skips malformed JSON lines', async () => {
    writeTraceFile('s2', '{"kind":"ok"}\nBAD_JSON\n{"kind":"also_ok"}');
    const result = await readSessionTraceEvents(TMP, 's2');
    assert.equal(result.length, 2);
    assert.equal(result[0].kind, 'ok');
    assert.equal(result[1].kind, 'also_ok');
  });

  it('returns empty array for missing file', async () => {
    const result = await readSessionTraceEvents(TMP, 'nonexistent');
    assert.deepEqual(result, []);
  });

  it('returns empty array for empty file', async () => {
    writeTraceFile('s3', '');
    const result = await readSessionTraceEvents(TMP, 's3');
    assert.deepEqual(result, []);
  });

  it('handles whitespace-only file', async () => {
    writeTraceFile('s4', '  \n  \n  ');
    const result = await readSessionTraceEvents(TMP, 's4');
    assert.deepEqual(result, []);
  });

  it('respects default limit of 500', async () => {
    const lines = Array.from({ length: 600 }, (_, i) =>
      JSON.stringify({ kind: 'event', idx: i })
    ).join('\n');
    writeTraceFile('s5', lines);
    const result = await readSessionTraceEvents(TMP, 's5');
    assert.equal(result.length, 500);
    // Should return the LAST 500 (tail)
    assert.equal(result[0].idx, 100);
    assert.equal(result[499].idx, 599);
  });

  it('respects custom limit', async () => {
    const lines = Array.from({ length: 20 }, (_, i) =>
      JSON.stringify({ kind: 'event', idx: i })
    ).join('\n');
    writeTraceFile('s6', lines);
    const result = await readSessionTraceEvents(TMP, 's6', 5);
    assert.equal(result.length, 5);
    // Last 5 events
    assert.equal(result[0].idx, 15);
  });

  it('clamps limit to minimum 1', async () => {
    writeTraceFile('s7', '{"kind":"a"}\n{"kind":"b"}');
    const result = await readSessionTraceEvents(TMP, 's7', 0);
    assert.equal(result.length, 1);
    assert.equal(result[0].kind, 'b');
  });

  it('clamps limit to maximum 5000', async () => {
    writeTraceFile('s8', '{"kind":"a"}');
    const result = await readSessionTraceEvents(TMP, 's8', 99999);
    assert.equal(result.length, 1);
  });

  it('handles trailing newline', async () => {
    writeTraceFile('s9', '{"kind":"a"}\n{"kind":"b"}\n');
    const result = await readSessionTraceEvents(TMP, 's9');
    assert.equal(result.length, 2);
  });

  it('handles negative limit by clamping to 1', async () => {
    writeTraceFile('s10', '{"kind":"a"}\n{"kind":"b"}\n{"kind":"c"}');
    const result = await readSessionTraceEvents(TMP, 's10', -5);
    assert.equal(result.length, 1);
    assert.equal(result[0].kind, 'c');
  });
});
