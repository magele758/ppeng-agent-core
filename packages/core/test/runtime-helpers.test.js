/**
 * Tests for public helper utilities that support the runtime:
 * - token estimation (estimateTokensFromText, estimateMessageTokens)
 * - trace I/O round-trips (appendTraceEvent + readSessionTraceEvents)
 * - error utilities (errorMessage, httpStatusFromError, error classes)
 * - env parsing (envInt, envBool)
 * - id generation (createId, nowIso)
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { estimateTokensFromText, estimateMessageTokens } from '../dist/model/token-estimate.js';
import { appendTraceEvent } from '../dist/stores/trace.js';
import { readSessionTraceEvents } from '../dist/stores/read-traces.js';
import {
  AppError,
  NotFoundError,
  ValidationError,
  PayloadTooLargeError,
  ConflictError,
  AuthorizationError,
  TimeoutError,
  errorMessage,
  httpStatusFromError
} from '../dist/errors.js';
import { envInt, envBool } from '../dist/env.js';
import { createId, nowIso } from '../dist/id.js';

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

describe('estimateTokensFromText edge cases', () => {
  it('returns 0 for empty string', () => {
    assert.equal(estimateTokensFromText(''), 0);
  });

  it('returns 0 for undefined/null-ish input', () => {
    assert.equal(estimateTokensFromText(undefined), 0);
    assert.equal(estimateTokensFromText(null), 0);
  });

  it('returns 1 for very short strings (1-4 chars)', () => {
    assert.equal(estimateTokensFromText('a'), 1);
    assert.equal(estimateTokensFromText('abcd'), 1);
  });

  it('rounds up for strings not divisible by 4', () => {
    assert.equal(estimateTokensFromText('abcde'), 2); // ceil(5/4) = 2
    assert.equal(estimateTokensFromText('abcdefg'), 2); // ceil(7/4) = 2
  });

  it('handles exact multiples of 4', () => {
    assert.equal(estimateTokensFromText('abcdefgh'), 2); // 8/4 = 2
    assert.equal(estimateTokensFromText('a'.repeat(100)), 25);
  });

  it('handles multi-byte unicode characters by string length', () => {
    const emoji = '😀😀😀😀'; // 4 emoji = 8 code units (surrogate pairs)
    const result = estimateTokensFromText(emoji);
    assert.ok(result >= 1);
    assert.equal(result, Math.max(1, Math.ceil(emoji.length / 4)));
  });
});

describe('estimateMessageTokens part types', () => {
  it('returns 0 for empty message array', () => {
    assert.equal(estimateMessageTokens([]), 0);
  });

  it('adds 4-token overhead per message', () => {
    const one = estimateMessageTokens([{ role: 'user', parts: [] }]);
    const two = estimateMessageTokens([
      { role: 'user', parts: [] },
      { role: 'assistant', parts: [] }
    ]);
    assert.equal(one, 4);
    assert.equal(two, 8);
  });

  it('estimates text parts', () => {
    const tokens = estimateMessageTokens([
      { role: 'user', parts: [{ type: 'text', text: 'a'.repeat(20) }] }
    ]);
    assert.equal(tokens, 4 + 5); // 4 overhead + ceil(20/4)
  });

  it('estimates reasoning parts', () => {
    const tokens = estimateMessageTokens([
      { role: 'assistant', parts: [{ type: 'reasoning', text: 'a'.repeat(12) }] }
    ]);
    assert.equal(tokens, 4 + 3); // 4 overhead + ceil(12/4)
  });

  it('estimates image parts at fixed 1200 tokens', () => {
    const tokens = estimateMessageTokens([
      { role: 'user', parts: [{ type: 'image', assetId: 'x', mimeType: 'image/png' }] }
    ]);
    assert.equal(tokens, 4 + 1200);
  });

  it('estimates tool_call parts from JSON-serialised input', () => {
    const input = { code: 'console.log("hello")' };
    const serialised = JSON.stringify(input);
    const tokens = estimateMessageTokens([
      { role: 'assistant', parts: [{ type: 'tool_call', toolCallId: 'tc1', name: 'run', input }] }
    ]);
    assert.equal(tokens, 4 + Math.max(1, Math.ceil(serialised.length / 4)));
  });

  it('estimates tool_call with undefined input as 0 extra tokens', () => {
    const tokens = estimateMessageTokens([
      { role: 'assistant', parts: [{ type: 'tool_call', toolCallId: 'tc1', name: 'run' }] }
    ]);
    // input undefined → stringify yields '' → estimateTokensFromText('') = 0
    assert.equal(tokens, 4);
  });

  it('estimates tool_result parts from content string', () => {
    const content = 'success: file written';
    const tokens = estimateMessageTokens([
      { role: 'tool', parts: [{ type: 'tool_result', content }] }
    ]);
    assert.equal(tokens, 4 + Math.max(1, Math.ceil(content.length / 4)));
  });

  it('sums tokens across multiple mixed parts', () => {
    const tokens = estimateMessageTokens([
      {
        role: 'assistant',
        parts: [
          { type: 'text', text: 'hello' },
          { type: 'tool_call', toolCallId: 'tc1', name: 'f', input: { a: 1 } }
        ]
      }
    ]);
    const textTok = Math.max(1, Math.ceil('hello'.length / 4));
    const callTok = Math.max(1, Math.ceil(JSON.stringify({ a: 1 }).length / 4));
    assert.equal(tokens, 4 + textTok + callTok);
  });

  it('ignores unknown part types gracefully', () => {
    const tokens = estimateMessageTokens([
      { role: 'user', parts: [{ type: 'custom_widget', data: 'xyz' }] }
    ]);
    assert.equal(tokens, 4); // only overhead, unknown type adds nothing
  });
});

// ---------------------------------------------------------------------------
// Trace round-trips (appendTraceEvent → readSessionTraceEvents)
// ---------------------------------------------------------------------------

describe('trace round-trip', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'rt-helpers-' + process.pid + '-'));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('write then read yields same event kind and payload', async () => {
    const sid = 'roundtrip_1';
    await appendTraceEvent(tmpDir, sid, { kind: 'turn_start', payload: { turnIndex: 0 } });
    const events = await readSessionTraceEvents(tmpDir, sid);
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'turn_start');
    assert.equal(events[0].sessionId, sid);
    assert.deepEqual(events[0].payload, { turnIndex: 0 });
    assert.ok(events[0].ts);
  });

  it('multiple appends produce ordered events', async () => {
    const sid = 'roundtrip_2';
    await appendTraceEvent(tmpDir, sid, { kind: 'tool_start', payload: { tool: 'a' } });
    await appendTraceEvent(tmpDir, sid, { kind: 'tool_end', payload: { tool: 'a', ok: true } });
    await appendTraceEvent(tmpDir, sid, { kind: 'turn_end' });
    const events = await readSessionTraceEvents(tmpDir, sid);
    assert.equal(events.length, 3);
    assert.deepEqual(events.map(e => e.kind), ['tool_start', 'tool_end', 'turn_end']);
  });

  it('read respects limit parameter', async () => {
    const sid = 'roundtrip_3';
    for (let i = 0; i < 5; i++) {
      await appendTraceEvent(tmpDir, sid, { kind: 'turn_start', payload: { i } });
    }
    const last2 = await readSessionTraceEvents(tmpDir, sid, 2);
    assert.equal(last2.length, 2);
    assert.equal(last2[0].payload.i, 3);
    assert.equal(last2[1].payload.i, 4);
  });

  it('events without payload round-trip correctly', async () => {
    const sid = 'roundtrip_4';
    await appendTraceEvent(tmpDir, sid, { kind: 'cancel' });
    const events = await readSessionTraceEvents(tmpDir, sid);
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'cancel');
    assert.equal(events[0].payload, undefined);
  });
});

// ---------------------------------------------------------------------------
// Error utilities – edge cases beyond errors.test.js
// ---------------------------------------------------------------------------

describe('errorMessage edge cases', () => {
  it('handles null', () => {
    assert.equal(errorMessage(null), 'null');
  });

  it('handles undefined', () => {
    assert.equal(errorMessage(undefined), 'undefined');
  });

  it('handles numeric thrown value', () => {
    assert.equal(errorMessage(42), '42');
  });

  it('handles object without message property', () => {
    const result = errorMessage({ code: 'FAIL' });
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
  });
});

describe('httpStatusFromError edge cases', () => {
  it('maps each AppError subclass to its status code', () => {
    assert.equal(httpStatusFromError(new NotFoundError('x')), 404);
    assert.equal(httpStatusFromError(new ValidationError('bad')), 400);
    assert.equal(httpStatusFromError(new PayloadTooLargeError(1024)), 413);
    assert.equal(httpStatusFromError(new ConflictError('dup')), 409);
    assert.equal(httpStatusFromError(new AuthorizationError()), 403);
    assert.equal(httpStatusFromError(new TimeoutError()), 504);
  });

  it('returns 500 for plain object', () => {
    assert.equal(httpStatusFromError({ message: 'oops' }), 500);
  });

  it('returns 500 for string thrown value', () => {
    assert.equal(httpStatusFromError('crash'), 500);
  });
});

// ---------------------------------------------------------------------------
// envInt / envBool – supplementary edge cases
// ---------------------------------------------------------------------------

describe('envInt supplementary', () => {
  it('trims whitespace around numeric value', () => {
    assert.equal(envInt({ X: '  7  ' }, 'X', 1), 7);
  });

  it('returns fallback for boolean-ish strings', () => {
    assert.equal(envInt({ X: 'true' }, 'X', 99), 99);
  });

  it('parses large integers', () => {
    assert.equal(envInt({ X: '100000' }, 'X', 1), 100000);
  });
});

describe('envBool supplementary', () => {
  it('treats numeric string "0" as false when default true', () => {
    assert.equal(envBool({ X: '0' }, 'X', true), false);
  });

  it('treats numeric string "1" as true when default false', () => {
    assert.equal(envBool({ X: '1' }, 'X', false), true);
  });

  it('treats mixed case "True" as true when default false', () => {
    assert.equal(envBool({ X: 'True' }, 'X', false), true);
  });
});

// ---------------------------------------------------------------------------
// createId / nowIso – supplementary edge cases
// ---------------------------------------------------------------------------

describe('createId supplementary', () => {
  it('successive calls produce distinct values', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createId('t')));
    assert.equal(ids.size, 50);
  });

  it('prefix with special characters is preserved verbatim', () => {
    const id = createId('my-agent.v2');
    assert.ok(id.startsWith('my-agent.v2_'));
  });
});

describe('nowIso supplementary', () => {
  it('returns a string parseable by Date constructor', () => {
    const iso = nowIso();
    const d = new Date(iso);
    assert.ok(!isNaN(d.getTime()));
  });

  it('is within 1 second of Date.now()', () => {
    const before = Date.now();
    const iso = nowIso();
    const after = Date.now();
    const t = new Date(iso).getTime();
    assert.ok(t >= before - 1 && t <= after + 1);
  });
});
