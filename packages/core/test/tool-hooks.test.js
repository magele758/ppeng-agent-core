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

// ── Additional tests ──

test('hook returns empty result when no script is configured', async () => {
  const { runToolHook } = await import('../dist/tools/tool-hooks.js');
  const r = await runToolHook(
    { ...process.env },
    { phase: 'pre_tool_use', tool: 'bash', sessionId: 's1', input: {} }
  );
  assert.deepEqual(r, {});
});

test('hook returns empty result for post_tool_use with no script', async () => {
  const { runToolHook } = await import('../dist/tools/tool-hooks.js');
  const r = await runToolHook(
    { ...process.env },
    { phase: 'post_tool_use', tool: 'bash', sessionId: 's1', input: {}, ok: true, content: 'done' }
  );
  assert.deepEqual(r, {});
});

test('successful hook exits 0 with empty stdout', async () => {
  const { runToolHook } = await import('../dist/tools/tool-hooks.js');
  const script = join(tmpdir(), `ok-hook-${Date.now()}.js`);
  writeFileSync(script, 'process.exit(0);\n');
  try {
    const r = await runToolHook(
      { ...process.env, RAW_AGENT_HOOK_PRE_TOOL: script },
      { phase: 'pre_tool_use', tool: 'bash', sessionId: 's1', input: { x: 1 } }
    );
    assert.equal(r.block, undefined);
    assert.equal(r.message, undefined);
  } finally {
    try { unlinkSync(script); } catch { /* ignore */ }
  }
});

test('hook that outputs JSON with block field', async () => {
  const { runToolHook } = await import('../dist/tools/tool-hooks.js');
  const script = join(tmpdir(), `json-hook-${Date.now()}.js`);
  writeFileSync(script, `process.stdout.write(JSON.stringify({ block: true, message: 'not allowed' }));\n`);
  try {
    const r = await runToolHook(
      { ...process.env, RAW_AGENT_HOOK_PRE_TOOL: script },
      { phase: 'pre_tool_use', tool: 'bash', sessionId: 's1', input: {} }
    );
    assert.equal(r.block, true);
    assert.equal(r.message, 'not allowed');
  } finally {
    try { unlinkSync(script); } catch { /* ignore */ }
  }
});

test('hook that outputs JSON with input replacement', async () => {
  const { runToolHook } = await import('../dist/tools/tool-hooks.js');
  const script = join(tmpdir(), `input-hook-${Date.now()}.js`);
  writeFileSync(script, `process.stdout.write(JSON.stringify({ input: { replaced: true } }));\n`);
  try {
    const r = await runToolHook(
      { ...process.env, RAW_AGENT_HOOK_PRE_TOOL: script },
      { phase: 'pre_tool_use', tool: 'edit_file', sessionId: 's1', input: { original: true } }
    );
    assert.deepEqual(r.input, { replaced: true });
  } finally {
    try { unlinkSync(script); } catch { /* ignore */ }
  }
});

test('hook that outputs plain text returns it as message', async () => {
  const { runToolHook } = await import('../dist/tools/tool-hooks.js');
  const script = join(tmpdir(), `text-hook-${Date.now()}.js`);
  writeFileSync(script, `process.stdout.write('some plain text output');\n`);
  try {
    const r = await runToolHook(
      { ...process.env, RAW_AGENT_HOOK_POST_TOOL: script },
      { phase: 'post_tool_use', tool: 'bash', sessionId: 's1', input: {}, ok: true, content: '' }
    );
    assert.equal(r.message, 'some plain text output');
  } finally {
    try { unlinkSync(script); } catch { /* ignore */ }
  }
});

test('hook with nonexistent script path returns spawn error', async () => {
  const { runToolHook } = await import('../dist/tools/tool-hooks.js');
  const r = await runToolHook(
    { ...process.env, RAW_AGENT_HOOK_PRE_TOOL: '/nonexistent/path/hook-does-not-exist.js' },
    { phase: 'pre_tool_use', tool: 'bash', sessionId: 's1', input: {} }
  );
  assert.ok(r.message);
  assert.ok(r.message.includes('hook') || r.message.includes('ENOENT') || r.message.includes('spawn'));
});

test('pre_tool_use hook that exits non-zero sets block=true', async () => {
  const { runToolHook } = await import('../dist/tools/tool-hooks.js');
  const script = join(tmpdir(), `fail-pre-${Date.now()}.js`);
  writeFileSync(script, `process.stderr.write('denied'); process.exit(1);\n`);
  try {
    const r = await runToolHook(
      { ...process.env, RAW_AGENT_HOOK_PRE_TOOL: script },
      { phase: 'pre_tool_use', tool: 'bash', sessionId: 's1', input: {} }
    );
    assert.equal(r.block, true);
    assert.ok(r.message);
  } finally {
    try { unlinkSync(script); } catch { /* ignore */ }
  }
});

test('post_tool_use hook that exits non-zero sets block=false', async () => {
  const { runToolHook } = await import('../dist/tools/tool-hooks.js');
  const script = join(tmpdir(), `fail-post-${Date.now()}.js`);
  writeFileSync(script, `process.stderr.write('oops'); process.exit(1);\n`);
  try {
    const r = await runToolHook(
      { ...process.env, RAW_AGENT_HOOK_POST_TOOL: script },
      { phase: 'post_tool_use', tool: 'bash', sessionId: 's1', input: {}, ok: true, content: '' }
    );
    assert.equal(r.block, false);
  } finally {
    try { unlinkSync(script); } catch { /* ignore */ }
  }
});

test('hook receives payload on stdin as JSON', async () => {
  const { runToolHook } = await import('../dist/tools/tool-hooks.js');
  const script = join(tmpdir(), `echo-hook-${Date.now()}.js`);
  writeFileSync(script, `
    let data = '';
    process.stdin.on('data', c => data += c);
    process.stdin.on('end', () => {
      const p = JSON.parse(data);
      process.stdout.write(JSON.stringify({ message: 'tool=' + p.tool }));
    });
  `);
  try {
    const r = await runToolHook(
      { ...process.env, RAW_AGENT_HOOK_PRE_TOOL: script },
      { phase: 'pre_tool_use', tool: 'my_tool', sessionId: 's1', input: { val: 42 } }
    );
    assert.equal(r.message, 'tool=my_tool');
  } finally {
    try { unlinkSync(script); } catch { /* ignore */ }
  }
});
