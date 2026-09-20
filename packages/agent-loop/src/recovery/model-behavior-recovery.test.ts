import { describe, it, expect, vi } from 'vitest';
import {
  buildSyntheticBehaviorResult,
  isToolAvailabilityError,
  recoverFromModelBehavior,
} from './model-behavior-recovery.js';

describe('recovery/model-behavior-recovery', () => {
  describe('buildSyntheticBehaviorResult', () => {
    it('marks tool-availability errors and includes hint + sample', () => {
      const result = buildSyntheticBehaviorResult(
        { toolCallId: 'call_xyz', name: 'sandbox_start' },
        new Error('Tool sandbox_start not found in agent default-butler.'),
        ['skill', 'generate_image', 'web_search']
      );

      expect(result).toMatchObject({
        toolCallId: 'call_xyz',
        name: 'sandbox_start',
        ok: false,
      });
      expect(isToolAvailabilityError(new Error('Tool sandbox_start not found in agent default-butler.'))).toBe(
        true
      );

      const parsed = JSON.parse(result.content);
      expect(parsed.error).toContain('sandbox_start');
      expect(parsed.error).toContain('not available');
      expect(parsed.available_tools_sample).toEqual(['skill', 'generate_image', 'web_search']);
      expect(parsed.did_you_mean).toBeNull();
      expect(parsed.hint).toContain('disabled by configuration');
    });

    it('does not treat unrelated model errors as missing tools', () => {
      const result = buildSyntheticBehaviorResult(
        { toolCallId: 'call_xyz', name: 'sandbox_start' },
        new Error('Model did not produce a final response!'),
        ['skill', 'generate_image', 'web_search']
      );
      expect(isToolAvailabilityError(new Error('Model did not produce a final response!'))).toBe(false);
      const parsed = JSON.parse(result.content);
      expect(parsed.error).toBe("Model behavior error while handling tool call 'sandbox_start'.");
      expect(parsed.error_raw).toBe('Model did not produce a final response!');
      expect(parsed.hint).toBeUndefined();
    });

    it('caps available_tools_sample at 20 and fills did_you_mean', () => {
      const tools = Array.from({ length: 30 }, (_, i) => `tool_${i}`);
      const capped = buildSyntheticBehaviorResult(
        { toolCallId: 'c', name: 'foo' },
        new Error('Tool foo not found.'),
        tools
      );
      expect(JSON.parse(capped.content).available_tools_sample).toHaveLength(20);

      const similar = buildSyntheticBehaviorResult(
        { toolCallId: 'c', name: 'sandbox_strt' },
        new Error('Tool sandbox_strt not found.'),
        ['sandbox_start', 'web_search']
      );
      expect(JSON.parse(similar.content).did_you_mean).toBe('sandbox_start');
    });
  });

  describe('recoverFromModelBehavior', () => {
    it('injects one synthetic result per pending call via appendResults', async () => {
      const appendResults = vi.fn().mockResolvedValue(undefined);
      const pending = [
        { toolCallId: 'call_1', name: 'sandbox_start' },
        { toolCallId: 'call_2', name: 'unknown_tool' },
      ];

      const { recovered, results } = await recoverFromModelBehavior({
        error: new Error('Tool sandbox_start not found in agent X.'),
        pending,
        currentToolNames: ['skill', 'web_search'],
        appendResults,
      });

      expect(recovered).toBe(true);
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ toolCallId: 'call_1', name: 'sandbox_start', ok: false });
      expect(results[1]).toMatchObject({ toolCallId: 'call_2', name: 'unknown_tool', ok: false });
      expect(appendResults).toHaveBeenCalledTimes(1);
      expect(appendResults).toHaveBeenCalledWith(results);
    });

    it('returns recovered:false for empty pending and does not append', async () => {
      const appendResults = vi.fn();
      const { recovered, results } = await recoverFromModelBehavior({
        error: new Error('Some unrelated error'),
        pending: [],
        currentToolNames: [],
        appendResults,
      });
      expect(recovered).toBe(false);
      expect(results).toEqual([]);
      expect(appendResults).not.toHaveBeenCalled();
    });

    it('still returns results when appendResults is missing', async () => {
      const { recovered, results } = await recoverFromModelBehavior({
        error: new Error('boom'),
        pending: [{ toolCallId: 'c', name: 'foo' }],
        currentToolNames: [],
      });
      expect(recovered).toBe(false);
      expect(results).toHaveLength(1);
      expect(results[0]!.toolCallId).toBe('c');
    });

    it('returns recovered:false when appendResults throws', async () => {
      const { recovered, results } = await recoverFromModelBehavior({
        error: new Error('boom'),
        pending: [{ toolCallId: 'c', name: 'foo' }],
        currentToolNames: [],
        appendResults: () => {
          throw new Error('persist failed');
        },
      });
      expect(recovered).toBe(false);
      expect(results).toHaveLength(1);
    });
  });
});
