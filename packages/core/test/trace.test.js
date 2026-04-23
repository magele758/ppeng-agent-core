import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { appendTraceEvent } = await import('../dist/stores/trace.js');

function makeTempDir() {
  return join(tmpdir(), 'ppeng-trace-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
}

describe('trace module', () => {
  let stateDir;

  beforeEach(() => {
    stateDir = makeTempDir();
  });

  afterEach(() => {
    try {
      rmSync(stateDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('appendTraceEvent', () => {
    it('creates directory structure if not exists', async () => {
      const sessionId = 'test-session-1';
      const event = { kind: 'turn_start' };

      await appendTraceEvent(stateDir, sessionId, event);

      const eventsFile = join(stateDir, 'traces', sessionId, 'events.jsonl');
      assert.ok(readFileSync(eventsFile, 'utf8'));
    });

    it('writes valid JSONL line with ts, sessionId, kind, payload', async () => {
      const sessionId = 'test-session-2';
      const event = {
        kind: 'tool_start',
        payload: { toolName: 'grep', args: { pattern: 'test' } },
      };

      await appendTraceEvent(stateDir, sessionId, event);

      const eventsFile = join(stateDir, 'traces', sessionId, 'events.jsonl');
      const content = readFileSync(eventsFile, 'utf8').trim();
      const parsed = JSON.parse(content);

      assert.ok(parsed.ts);
      assert.ok(typeof parsed.ts === 'string');
      assert.match(parsed.ts, /^\d{4}-\d{2}-\d{2}T/); // ISO 8601 format
      assert.equal(parsed.sessionId, sessionId);
      assert.equal(parsed.kind, 'tool_start');
      assert.deepEqual(parsed.payload, { toolName: 'grep', args: { pattern: 'test' } });
    });

    it('appends multiple events each on separate line', async () => {
      const sessionId = 'test-session-3';
      const events = [
        { kind: 'turn_start' },
        { kind: 'tool_start', payload: { toolName: 'bash' } },
        { kind: 'tool_end', payload: { success: true } },
        { kind: 'turn_end' },
      ];

      for (const event of events) {
        await appendTraceEvent(stateDir, sessionId, event);
      }

      const eventsFile = join(stateDir, 'traces', sessionId, 'events.jsonl');
      const content = readFileSync(eventsFile, 'utf8');
      const lines = content.trim().split('\n');

      assert.equal(lines.length, 4);
      
      const parsed = lines.map(line => JSON.parse(line));
      assert.equal(parsed[0].kind, 'turn_start');
      assert.equal(parsed[1].kind, 'tool_start');
      assert.equal(parsed[2].kind, 'tool_end');
      assert.equal(parsed[3].kind, 'turn_end');
    });

    it('handles events without payload', async () => {
      const sessionId = 'test-session-4';
      const event = { kind: 'cancel' };

      await appendTraceEvent(stateDir, sessionId, event);

      const eventsFile = join(stateDir, 'traces', sessionId, 'events.jsonl');
      const content = readFileSync(eventsFile, 'utf8').trim();
      const parsed = JSON.parse(content);

      assert.equal(parsed.kind, 'cancel');
      assert.equal(parsed.payload, undefined);
    });

    it('preserves kind field correctly', async () => {
      const sessionId = 'test-session-5';
      const kinds = [
        'turn_start',
        'turn_end',
        'tool_start',
        'tool_end',
        'model_error',
        'compact',
        'cancel',
        'skill_load',
        'otel_proxy',
        'refusal_preservation',
        'recovery_abort',
        'evolving_case',
        'evolving_coach'
      ];

      for (const kind of kinds) {
        await appendTraceEvent(stateDir, sessionId, { kind });
      }

      const eventsFile = join(stateDir, 'traces', sessionId, 'events.jsonl');
      const content = readFileSync(eventsFile, 'utf8');
      const lines = content.trim().split('\n');
      const parsed = lines.map(line => JSON.parse(line));

      for (let i = 0; i < kinds.length; i++) {
        assert.equal(parsed[i].kind, kinds[i]);
      }
    });
  });
});
