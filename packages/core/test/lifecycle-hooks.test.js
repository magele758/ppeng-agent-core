import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('lifecycle session_start returns empty when unset', async () => {
  const { runLifecycleHook } = await import('../dist/hooks/lifecycle-hooks.js');
  const r = await runLifecycleHook(
    { ...process.env },
    { phase: 'session_start', sessionId: 's1' }
  );
  assert.deepEqual(r, {});
});

test('lifecycle pre_tool_use maps permissionDecision=deny to block', async () => {
  const { runLifecycleHook, lifecycleBlocks } = await import('../dist/hooks/lifecycle-hooks.js');
  const script = join(tmpdir(), `deny-hook-${Date.now()}.js`);
  writeFileSync(
    script,
    'process.stdout.write(JSON.stringify({ permissionDecision: "deny", systemMessage: "nope" }));\n'
  );
  try {
    const r = await runLifecycleHook(
      { ...process.env, RAW_AGENT_HOOK_PRE_TOOL: script },
      { phase: 'pre_tool_use', tool: 'bash', sessionId: 's1', input: {} }
    );
    assert.equal(lifecycleBlocks(r), true);
    assert.equal(r.permissionDecision, 'deny');
  } finally {
    try {
      unlinkSync(script);
    } catch {
      /* ignore */
    }
  }
});

test('lifecycle stop hook parses Claude-style nested hookSpecificOutput', async () => {
  const { runLifecycleHook } = await import('../dist/hooks/lifecycle-hooks.js');
  const script = join(tmpdir(), `stop-hook-${Date.now()}.js`);
  writeFileSync(
    script,
    'process.stdout.write(JSON.stringify({ hookSpecificOutput: { permissionDecision: "ask", systemMessage: "verify" } }));\n'
  );
  try {
    const r = await runLifecycleHook(
      { ...process.env, RAW_AGENT_HOOK_STOP: script },
      { phase: 'stop', sessionId: 's1' }
    );
    assert.equal(r.permissionDecision, 'ask');
    assert.equal(r.systemMessage, 'verify');
  } finally {
    try {
      unlinkSync(script);
    } catch {
      /* ignore */
    }
  }
});
