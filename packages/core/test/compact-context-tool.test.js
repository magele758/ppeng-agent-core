import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompactContextTool } from '../dist/tools/compact-context-tool.js';

test('compact_context calls existing autoCompact API with force default true', async () => {
  const calls = [];
  const tool = createCompactContextTool({
    compactContext: async (_ctx, opts) => {
      calls.push(opts);
      return 'compacted';
    }
  });
  assert.equal(tool.name, 'compact_context');
  const result = await tool.execute({ session: { id: 's1', metadata: {} } }, {});
  assert.equal(result.ok, true);
  assert.equal(result.content, 'compacted');
  assert.deepEqual(calls, [{ force: true }]);
});
