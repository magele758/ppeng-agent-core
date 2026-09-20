import { describe, it, expect } from 'vitest';
import type { SessionMessage } from '../types.js';
import {
  CHECKPOINTS_METADATA_KEY,
  decideRewindTail,
  isClosedBoundary,
  lastClosedSeq,
  latestCheckpoint,
  parseCheckpoints
} from './checkpoint.js';

function msg(
  role: SessionMessage['role'],
  parts: SessionMessage['parts'],
  seq = 1
): SessionMessage {
  return {
    id: `m${seq}`,
    sessionId: 's',
    role,
    parts,
    createdAt: 't',
    seq
  };
}

describe('session/checkpoint', () => {
  describe('parseCheckpoints', () => {
    it('returns empty for missing or non-array metadata', () => {
      expect(parseCheckpoints(undefined)).toEqual([]);
      expect(parseCheckpoints({})).toEqual([]);
      expect(parseCheckpoints({ [CHECKPOINTS_METADATA_KEY]: 'nope' })).toEqual([]);
    });

    it('skips invalid items and fills optional defaults', () => {
      const list = parseCheckpoints({
        [CHECKPOINTS_METADATA_KEY]: [
          null,
          { id: 1 },
          { id: 'c1', sessionId: 's', seq: Number.NaN },
          { id: 'c2', sessionId: 's', seq: 3 },
          { id: 'c3', sessionId: 's', seq: 4, turn: 1, label: 'ok', createdAt: '2026-01-01' }
        ]
      });
      expect(list).toEqual([
        { id: 'c2', sessionId: 's', seq: 3, turn: -1, label: '', createdAt: '' },
        { id: 'c3', sessionId: 's', seq: 4, turn: 1, label: 'ok', createdAt: '2026-01-01' }
      ]);
    });
  });

  describe('latestCheckpoint', () => {
    it('returns the last parsed entry, not max-by-seq', () => {
      const latest = latestCheckpoint({
        [CHECKPOINTS_METADATA_KEY]: [
          { id: 'c2', sessionId: 's', seq: 9 },
          { id: 'c1', sessionId: 's', seq: 2 }
        ]
      });
      expect(latest?.id).toBe('c1');
      expect(latest?.seq).toBe(2);
    });

    it('returns undefined when empty', () => {
      expect(latestCheckpoint(undefined)).toBeUndefined();
    });
  });

  describe('isClosedBoundary', () => {
    it('is false for empty fold', () => {
      expect(isClosedBoundary([])).toBe(false);
    });

    it('is true when no unmatched tool_call', () => {
      expect(
        isClosedBoundary([
          msg('user', [{ type: 'text', text: 'hi' }], 1),
          msg('assistant', [{ type: 'text', text: 'yo' }], 2)
        ])
      ).toBe(true);
    });

    it('is false while a tool wave is open', () => {
      expect(
        isClosedBoundary([
          msg(
            'assistant',
            [{ type: 'tool_call', toolCallId: 'c1', name: 'bash', input: {} }],
            1
          )
        ])
      ).toBe(false);
    });

    it('is true after the matching tool_result', () => {
      expect(
        isClosedBoundary([
          msg(
            'assistant',
            [{ type: 'tool_call', toolCallId: 'c1', name: 'bash', input: {} }],
            1
          ),
          msg(
            'tool',
            [{ type: 'tool_result', toolCallId: 'c1', name: 'bash', content: 'ok', ok: true }],
            2
          )
        ])
      ).toBe(true);
    });
  });

  describe('lastClosedSeq', () => {
    it('returns last node seq when fold is closed', () => {
      const folded = [msg('user', [{ type: 'text', text: 'a' }], 1)];
      expect(lastClosedSeq([{ seq: 1 }, { seq: 4 }], folded)).toBe(4);
    });

    it('returns undefined when wave is open or nodes empty', () => {
      const open = [
        msg('assistant', [{ type: 'tool_call', toolCallId: 'c', name: 'bash', input: {} }], 2)
      ];
      expect(lastClosedSeq([{ seq: 2 }], open)).toBeUndefined();
      expect(lastClosedSeq([], [msg('user', [{ type: 'text', text: 'a' }], 1)])).toBeUndefined();
    });
  });

  describe('decideRewindTail', () => {
    it('does not rewind without a checkpoint or when already at/before it', () => {
      expect(decideRewindTail({ currentSeq: 5, checkpointSeq: undefined })).toEqual({
        shouldRewind: false,
        fromSeq: 0,
        toSeq: 0
      });
      expect(decideRewindTail({ currentSeq: 3, checkpointSeq: 3 })).toEqual({
        shouldRewind: false,
        fromSeq: 0,
        toSeq: 3
      });
    });

    it('hides (checkpoint+1)..current when current is ahead', () => {
      expect(decideRewindTail({ currentSeq: 7, checkpointSeq: 3 })).toEqual({
        shouldRewind: true,
        fromSeq: 4,
        toSeq: 7
      });
    });
  });
});
