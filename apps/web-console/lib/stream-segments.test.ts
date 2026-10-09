import test from 'node:test';
import assert from 'node:assert/strict';
import { rollbackToCheckpoint, streamCheckpoint, type StreamSegment } from './stream-segments.ts';

test('rollback drops segments added after the checkpoint and restores merged text [AC:upstream-resilience#AC-3]', () => {
  const segments: StreamSegment[] = [
    { kind: 'tool', id: 's-1', toolCallId: 'c1', name: 'read_file', args: '{}' },
    { kind: 'text', id: 's-2', raw: 'turn one', html: '<p>turn one</p>' }
  ];
  const cp = streamCheckpoint(segments);
  const last = segments[1] as Extract<StreamSegment, { kind: 'text' }>;
  last.raw += ' PARTIAL';
  segments.push({ kind: 'reasoning', id: 's-3', text: 'thinking' });

  rollbackToCheckpoint(segments, cp);

  assert.equal(segments.length, 2);
  assert.deepEqual(segments[1], { kind: 'text', id: 's-2', raw: 'turn one', html: '<p>turn one</p>' });
});

test('rollback to an empty checkpoint clears the stream; a2ui envelopes are not shared', () => {
  const segments: StreamSegment[] = [];
  const empty = streamCheckpoint(segments);
  segments.push({ kind: 'a2ui', id: 's-1', surfaceId: 'x', catalogId: 'c', envelopes: [1] });
  const cp = streamCheckpoint(segments);
  (segments[0] as Extract<StreamSegment, { kind: 'a2ui' }>).envelopes.push(2);

  rollbackToCheckpoint(segments, cp);
  assert.deepEqual((segments[0] as Extract<StreamSegment, { kind: 'a2ui' }>).envelopes, [1]);

  rollbackToCheckpoint(segments, empty);
  assert.deepEqual(segments, []);
});
