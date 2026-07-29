import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MICRO_COMPACT_CONFIG,
  microCompactConfigFromEnv,
  microCompactMessages
} from '../dist/session/micro-compact.js';

function toolMsg(id, name, content, ok = true) {
  return {
    id,
    sessionId: 's1',
    role: 'tool',
    parts: [{ type: 'tool_result', toolCallId: `c-${id}`, name, ok, content }],
    createdAt: '2026-01-01T00:00:00.000Z'
  };
}

const CFG = { ...DEFAULT_MICRO_COMPACT_CONFIG, keepRecent: 2, minChars: 10, hardMaxChars: 1000 };

test('microCompactConfigFromEnv reads overrides', () => {
  const cfg = microCompactConfigFromEnv({
    RAW_AGENT_MICRO_COMPACT_KEEP_RECENT: '5',
    RAW_AGENT_MICRO_COMPACT_MIN_CHARS: '50'
  });
  assert.equal(cfg.keepRecent, 5);
  assert.equal(cfg.minChars, 50);
  assert.equal(cfg.enabled, true);
  assert.equal(microCompactConfigFromEnv({ RAW_AGENT_MICRO_COMPACT: '0' }).enabled, false);
});

test('disabled config is a pass-through', () => {
  const input = [toolMsg('1', 'bash', 'x'.repeat(500))];
  const out = microCompactMessages(input, { ...CFG, enabled: false });
  assert.equal(out.messages, input, 'same array reference');
  assert.equal(out.stats.collapsed, 0);
});

test('older tool results collapse, recent ones survive verbatim', () => {
  const input = [
    toolMsg('1', 'bash', 'a'.repeat(400)),
    toolMsg('2', 'read_file', 'b'.repeat(400)),
    toolMsg('3', 'grep', 'c'.repeat(400)),
    toolMsg('4', 'bash', 'd'.repeat(400))
  ];
  const { messages, stats } = microCompactMessages(input, CFG);
  assert.equal(stats.collapsed, 2);
  assert.match(messages[0].parts[0].content, /\[previous: used bash/);
  assert.match(messages[1].parts[0].content, /\[previous: used read_file/);
  assert.equal(messages[2].parts[0].content, 'c'.repeat(400));
  assert.equal(messages[3].parts[0].content, 'd'.repeat(400));
  assert.ok(stats.charsSaved > 600, `expected >600 chars saved, got ${stats.charsSaved}`);
});

test('failed results are marked when collapsed', () => {
  const input = [
    toolMsg('1', 'bash', 'stack trace '.repeat(50), false),
    toolMsg('2', 'bash', 'ok'),
    toolMsg('3', 'bash', 'ok')
  ];
  const { messages } = microCompactMessages(input, CFG);
  assert.match(messages[0].parts[0].content, /\(failed\)/);
});

test('short outputs are left alone even when old', () => {
  const input = [toolMsg('1', 'bash', 'tiny'), toolMsg('2', 'bash', 'x'), toolMsg('3', 'bash', 'y')];
  const { messages, stats } = microCompactMessages(input, CFG);
  assert.equal(stats.collapsed, 0);
  assert.equal(messages[0].parts[0].content, 'tiny');
});

test('recent oversized output is head+tail trimmed, not dropped', () => {
  const big = `HEAD-MARKER${'m'.repeat(5000)}TAIL-MARKER`;
  const { messages, stats } = microCompactMessages([toolMsg('1', 'bash', big)], CFG);
  const out = messages[0].parts[0].content;
  assert.equal(stats.trimmed, 1);
  assert.ok(out.length < big.length);
  assert.match(out, /HEAD-MARKER/);
  assert.match(out, /TAIL-MARKER/);
  assert.match(out, /chars truncated/);
});

test('non-tool parts and stored messages are untouched', () => {
  const input = [
    {
      id: 'u1',
      sessionId: 's1',
      role: 'user',
      parts: [{ type: 'text', text: 'hello' }],
      createdAt: '2026-01-01T00:00:00.000Z'
    },
    toolMsg('1', 'bash', 'a'.repeat(400)),
    toolMsg('2', 'bash', 'b'),
    toolMsg('3', 'bash', 'c')
  ];
  const original = input[1].parts[0].content;
  const { messages } = microCompactMessages(input, CFG);
  assert.equal(messages[0], input[0], 'untouched message keeps its reference');
  assert.equal(input[1].parts[0].content, original, 'input array was not mutated');
  assert.match(messages[1].parts[0].content, /\[previous: used bash/);
});

test('no tool results → pass-through', () => {
  const input = [
    {
      id: 'a1',
      sessionId: 's1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'hi' }],
      createdAt: '2026-01-01T00:00:00.000Z'
    }
  ];
  assert.equal(microCompactMessages(input, CFG).messages, input);
});
