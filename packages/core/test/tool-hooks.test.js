import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('pre_tool_use hook blocks when process is killed on timeout (SIGTERM)', async () => {
  const { runToolHook } = await import('../dist/tools/tool-hooks.js');
  const script = join(tmpdir(), `slow-hook-${Date.now()}.js`);
  writeFileSync(script, 'setInterval(() => {}, 1e9);\n');
  try {
    const r = await runToolHook(
      {
        ...process.env,
        RAW_AGENT_HOOK_PRE_TOOL: script,
        RAW_AGENT_HOOK_TIMEOUT_MS: '80'
      },
      { phase: 'pre_tool_use', tool: 'bash', sessionId: 's1', input: { x: 1 } }
    );
    assert.equal(r.block, true);
    assert.ok(String(r.message || '').includes('hook'));
  } finally {
    try {
      unlinkSync(script);
    } catch {
      /* ignore */
    }
  }
});

test('post_tool_use hook does not set block on timeout', async () => {
  const { runToolHook } = await import('../dist/tools/tool-hooks.js');
  const script = join(tmpdir(), `slow-post-${Date.now()}.js`);
  writeFileSync(script, 'setInterval(() => {}, 1e9);\n');
  try {
    const r = await runToolHook(
      {
        ...process.env,
        RAW_AGENT_HOOK_POST_TOOL: script,
        RAW_AGENT_HOOK_TIMEOUT_MS: '80'
      },
      { phase: 'post_tool_use', tool: 'bash', sessionId: 's1', input: {}, ok: true, content: '' }
    );
    assert.equal(r.block, false);
  } finally {
    try {
      unlinkSync(script);
    } catch {
      /* ignore */
    }
  }
});
