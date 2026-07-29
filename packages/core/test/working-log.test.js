import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendWorkingLogEntry,
  readWorkingLogTail,
  WORKING_LOG_FILENAME,
  workingLogEnabled,
  workingLogPath,
  workingLogTailChars
} from '../dist/session/working-log.js';

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ppeng-worklog-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('workingLogEnabled defaults on', () => {
  assert.equal(workingLogEnabled({}), true);
  assert.equal(workingLogEnabled({ RAW_AGENT_WORKING_LOG: '0' }), false);
});

test('workingLogTailChars honours env', () => {
  assert.equal(workingLogTailChars({}), 4_000);
  assert.equal(workingLogTailChars({ RAW_AGENT_WORKING_LOG_TAIL_CHARS: '999' }), 999);
});

test('workingLogPath is session-scoped and stable', () => {
  const p = workingLogPath('/state', 'sess-1');
  assert.ok(p.includes('sess-1'));
  assert.ok(p.endsWith(WORKING_LOG_FILENAME));
  assert.equal(workingLogPath('/state', 'sess-1'), p);
});

test('append creates missing dirs and is append-only', () => {
  withTempDir((dir) => {
    const p = workingLogPath(dir, 's1');
    appendWorkingLogEntry(p, { kind: 'compact_anchor', content: 'first', ts: 0 });
    appendWorkingLogEntry(p, { kind: 'step_outcome', content: 'second', ts: 0 });
    const body = readFileSync(p, 'utf8');
    assert.match(body, /first/);
    assert.match(body, /second/);
    assert.ok(body.indexOf('first') < body.indexOf('second'), 'order preserved');
  });
});

test('entry header carries kind, tool and ref', () => {
  withTempDir((dir) => {
    const p = workingLogPath(dir, 's1');
    appendWorkingLogEntry(p, {
      kind: 'artifact_indexed',
      content: 'report generated',
      sourceTool: 'bash',
      ref: '/tmp/archive.jsonl',
      ts: 0
    });
    const body = readFileSync(p, 'utf8');
    assert.match(body, /artifact_indexed/);
    assert.match(body, /bash/);
    assert.match(body, /archive\.jsonl/);
    assert.match(body, /1970-01-01/);
  });
});

test('missing file reads as empty, not an error', () => {
  withTempDir((dir) => {
    assert.equal(readWorkingLogTail(workingLogPath(dir, 'never-written')), '');
  });
});

test('tail truncates from the front and keeps the newest entries', () => {
  withTempDir((dir) => {
    const p = workingLogPath(dir, 's1');
    for (let i = 0; i < 60; i += 1) {
      appendWorkingLogEntry(p, { kind: 'step_outcome', content: `entry-${i} ${'x'.repeat(100)}`, ts: 0 });
    }
    const tail = readWorkingLogTail(p, 500);
    assert.ok(tail.length < 700);
    assert.match(tail, /earlier chars truncated/);
    assert.match(tail, /entry-59/);
    assert.doesNotMatch(tail, /entry-0 /);
  });
});

test('append failure is swallowed (log is an annex, not the turn)', () => {
  withTempDir((dir) => {
    // A path whose parent is a file, not a directory → mkdir/append must fail.
    const filePath = workingLogPath(dir, 's1');
    appendWorkingLogEntry(filePath, { kind: 'step_outcome', content: 'ok', ts: 0 });
    assert.doesNotThrow(() =>
      appendWorkingLogEntry(join(filePath, 'nested', 'log.md'), {
        kind: 'step_outcome',
        content: 'boom',
        ts: 0
      })
    );
  });
});
