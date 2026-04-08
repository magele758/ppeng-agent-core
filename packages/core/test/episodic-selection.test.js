import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectEpisodicMessages,
  estimateEpisodicCompression,
  groupIntoEpisodes,
  isEpisodeBoundary,
} from '../dist/model/episodic-selection.js';

// ── Test helpers ──

function msg(role, text, createdAt) {
  return {
    id: `msg_${Math.random().toString(36).slice(2)}`,
    sessionId: 'test-session',
    role,
    parts: [{ type: 'text', text }],
    createdAt: createdAt ?? new Date().toISOString(),
  };
}

function msgWithTool(role, toolName, createdAt) {
  return {
    id: `msg_${Math.random().toString(36).slice(2)}`,
    sessionId: 'test-session',
    role,
    parts: [{ type: 'tool_call', name: toolName, input: '{}' }],
    createdAt: createdAt ?? new Date().toISOString(),
  };
}

// ── isEpisodeBoundary ──

test('isEpisodeBoundary: no boundary for consecutive messages', () => {
  const now = new Date();
  const prev = msg('user', 'hello', now.toISOString());
  const curr = msg('assistant', 'hi', new Date(now.getTime() + 1000).toISOString());
  assert.equal(isEpisodeBoundary(prev, curr), false);
});

test('isEpisodeBoundary: boundary on >5min time gap', () => {
  const now = new Date();
  const prev = msg('user', 'hello', now.toISOString());
  const curr = msg('user', 'new topic', new Date(now.getTime() + 6 * 60 * 1000).toISOString());
  assert.equal(isEpisodeBoundary(prev, curr), true);
});

test('isEpisodeBoundary: boundary on task completion tool (curr is assistant with tool_call)', () => {
  const now = new Date();
  const prev = msg('user', 'write code', now.toISOString());
  const curr = msgWithTool('assistant', 'write_file', new Date(now.getTime() + 1000).toISOString());
  assert.equal(isEpisodeBoundary(prev, curr), true);
});

test('isEpisodeBoundary: no boundary for non-completion tool', () => {
  const now = new Date();
  const prev = msgWithTool('assistant', 'read_file', now.toISOString());
  const curr = msg('user', 'ok', new Date(now.getTime() + 1000).toISOString());
  assert.equal(isEpisodeBoundary(prev, curr), false);
});

// ── groupIntoEpisodes ──

test('groupIntoEpisodes: empty messages → empty array', () => {
  const episodes = groupIntoEpisodes([]);
  assert.deepEqual(episodes, []);
});

test('groupIntoEpisodes: single message → one episode', () => {
  const messages = [msg('user', 'hello')];
  const episodes = groupIntoEpisodes(messages);
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].length, 1);
});

test('groupIntoEpisodes: consecutive messages → one episode', () => {
  const now = new Date();
  const messages = [
    msg('user', 'hello', now.toISOString()),
    msg('assistant', 'hi', new Date(now.getTime() + 1000).toISOString()),
    msg('user', 'how are you', new Date(now.getTime() + 2000).toISOString()),
  ];
  const episodes = groupIntoEpisodes(messages);
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].length, 3);
});

test('groupIntoEpisodes: time gap creates new episode', () => {
  const now = new Date();
  const messages = [
    msg('user', 'topic 1', now.toISOString()),
    msg('assistant', 'response 1', new Date(now.getTime() + 1000).toISOString()),
    msg('user', 'topic 2', new Date(now.getTime() + 10 * 60 * 1000).toISOString()),
    msg('assistant', 'response 2', new Date(now.getTime() + 10 * 60 * 1000 + 1000).toISOString()),
  ];
  const episodes = groupIntoEpisodes(messages);
  assert.equal(episodes.length, 2);
  assert.equal(episodes[0].length, 2);
  assert.equal(episodes[1].length, 2);
});

test('groupIntoEpisodes: tool boundary creates new episode', () => {
  const now = new Date();
  const messages = [
    msg('user', 'write code', now.toISOString()),
    msgWithTool('assistant', 'write_file', new Date(now.getTime() + 1000).toISOString()),
    msg('user', 'now test it', new Date(now.getTime() + 2000).toISOString()),
  ];
  const episodes = groupIntoEpisodes(messages);
  assert.equal(episodes.length, 2);
});

// ── selectEpisodicMessages ──

test('selectEpisodicMessages: returns all when under budget', () => {
  const now = new Date();
  const messages = [
    msg('user', 'hello', now.toISOString()),
    msg('assistant', 'hi', new Date(now.getTime() + 1000).toISOString()),
  ];
  const selected = selectEpisodicMessages(messages, 100_000);
  assert.equal(selected.length, 2);
});

test('selectEpisodicMessages: empty messages → empty array', () => {
  const selected = selectEpisodicMessages([], 1000);
  assert.deepEqual(selected, []);
});

test('selectEpisodicMessages: compresses multi-episode conversations', () => {
  const now = new Date();
  const messages = [];
  // Create 5 episodes with 10-minute gaps
  for (let ep = 0; ep < 5; ep++) {
    const base = now.getTime() + ep * 10 * 60 * 1000;
    messages.push(msg('user', `Episode ${ep} question: ${'x'.repeat(200)}`, new Date(base).toISOString()));
    messages.push(msg('assistant', `Episode ${ep} answer: ${'y'.repeat(200)}`, new Date(base + 1000).toISOString()));
  }
  // Use a very small token budget to force compression
  const selected = selectEpisodicMessages(messages, 500);
  assert.ok(selected.length < messages.length, 'should compress');
  assert.ok(selected.length > 0, 'should keep some messages');
});

// ── estimateEpisodicCompression ──

test('estimateEpisodicCompression: returns ratio object', () => {
  const messages = [
    msg('user', 'hello'),
    msg('assistant', 'hi there, how can I help?'),
  ];
  const result = estimateEpisodicCompression(messages, 100_000);
  assert.ok(typeof result.originalTokens === 'number');
  assert.ok(typeof result.selectedTokens === 'number');
  assert.ok(typeof result.episodeCount === 'number');
  assert.ok(result.episodeCount >= 1);
});

test('estimateEpisodicCompression: empty messages → zero tokens', () => {
  const result = estimateEpisodicCompression([], 1000);
  assert.equal(result.originalTokens, 0);
  assert.equal(result.selectedTokens, 0);
});

// ── Additional edge-case tests ──

// -- isEpisodeBoundary extras --

test('isEpisodeBoundary: returns false when prev is undefined', () => {
  const curr = msg('user', 'hello');
  assert.equal(isEpisodeBoundary(undefined, curr), false);
});

test('isEpisodeBoundary: boundary on tool result with write_file', () => {
  const now = new Date();
  const prev = msg('assistant', 'writing', now.toISOString());
  const curr = {
    id: 'tr1',
    sessionId: 'test-session',
    role: 'tool',
    parts: [{ type: 'tool_result', name: 'write_file', content: 'ok', ok: true }],
    createdAt: new Date(now.getTime() + 1000).toISOString()
  };
  assert.equal(isEpisodeBoundary(prev, curr), true);
});

test('isEpisodeBoundary: boundary on tool result with commit', () => {
  const now = new Date();
  const prev = msg('assistant', 'committing', now.toISOString());
  const curr = {
    id: 'tr2',
    sessionId: 'test-session',
    role: 'tool',
    parts: [{ type: 'tool_result', name: 'commit', content: 'committed', ok: true }],
    createdAt: new Date(now.getTime() + 1000).toISOString()
  };
  assert.equal(isEpisodeBoundary(prev, curr), true);
});

test('isEpisodeBoundary: exact 5min gap is NOT a boundary', () => {
  const now = new Date();
  const prev = msg('user', 'hello', now.toISOString());
  const curr = msg('user', 'hi again', new Date(now.getTime() + 5 * 60 * 1000).toISOString());
  assert.equal(isEpisodeBoundary(prev, curr), false);
});

test('isEpisodeBoundary: no boundary for tool result with non-boundary tool', () => {
  const now = new Date();
  const prev = msg('assistant', 'reading', now.toISOString());
  const curr = {
    id: 'tr3',
    sessionId: 'test-session',
    role: 'tool',
    parts: [{ type: 'tool_result', name: 'read_file', content: 'data', ok: true }],
    createdAt: new Date(now.getTime() + 1000).toISOString()
  };
  assert.equal(isEpisodeBoundary(prev, curr), false);
});

test('isEpisodeBoundary: boundary on assistant calling run_tests', () => {
  const now = new Date();
  const prev = msg('user', 'test it', now.toISOString());
  const curr = msgWithTool('assistant', 'run_tests', new Date(now.getTime() + 1000).toISOString());
  assert.equal(isEpisodeBoundary(prev, curr), true);
});

// -- groupIntoEpisodes extras --

test('groupIntoEpisodes: alternating user/assistant pairs stay in one episode', () => {
  const now = new Date();
  const messages = [];
  for (let i = 0; i < 6; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    messages.push(msg(role, `msg ${i}`, new Date(now.getTime() + i * 1000).toISOString()));
  }
  const episodes = groupIntoEpisodes(messages);
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].length, 6);
});

test('groupIntoEpisodes: tool-result boundary tools split episodes', () => {
  const now = new Date();
  const messages = [
    msg('user', 'write code', now.toISOString()),
    msg('assistant', 'ok', new Date(now.getTime() + 1000).toISOString()),
    {
      id: 'tr_split',
      sessionId: 'test-session',
      role: 'tool',
      parts: [{ type: 'tool_result', name: 'edit_file', content: 'edited', ok: true }],
      createdAt: new Date(now.getTime() + 2000).toISOString()
    },
    msg('user', 'now test', new Date(now.getTime() + 3000).toISOString())
  ];
  const episodes = groupIntoEpisodes(messages);
  assert.equal(episodes.length, 2);
});

test('groupIntoEpisodes: multiple long gaps create multiple episodes', () => {
  const now = new Date();
  const gap = 10 * 60 * 1000; // 10min
  const messages = [
    msg('user', 'ep1', now.toISOString()),
    msg('assistant', 'r1', new Date(now.getTime() + 1000).toISOString()),
    msg('user', 'ep2', new Date(now.getTime() + gap).toISOString()),
    msg('assistant', 'r2', new Date(now.getTime() + gap + 1000).toISOString()),
    msg('user', 'ep3', new Date(now.getTime() + 2 * gap).toISOString()),
    msg('assistant', 'r3', new Date(now.getTime() + 2 * gap + 1000).toISOString())
  ];
  const episodes = groupIntoEpisodes(messages);
  assert.equal(episodes.length, 3);
  assert.equal(episodes[0].length, 2);
  assert.equal(episodes[1].length, 2);
  assert.equal(episodes[2].length, 2);
});

test('groupIntoEpisodes: preserves message ordering within episodes', () => {
  const now = new Date();
  const messages = [
    msg('user', 'first', now.toISOString()),
    msg('assistant', 'second', new Date(now.getTime() + 1000).toISOString()),
    msg('user', 'third', new Date(now.getTime() + 2000).toISOString())
  ];
  const episodes = groupIntoEpisodes(messages);
  assert.equal(episodes[0][0].parts[0].text, 'first');
  assert.equal(episodes[0][1].parts[0].text, 'second');
  assert.equal(episodes[0][2].parts[0].text, 'third');
});

// -- selectEpisodicMessages extras --

test('selectEpisodicMessages: budget of 0 still returns something (minRecent fallback)', () => {
  const now = new Date();
  const messages = [];
  for (let i = 0; i < 20; i++) {
    const base = now.getTime() + (i < 10 ? i * 1000 : 10 * 60 * 1000 + i * 1000);
    messages.push(msg('user', `q${i}`, new Date(base).toISOString()));
    messages.push(msg('assistant', `a${i}`, new Date(base + 500).toISOString()));
  }
  const selected = selectEpisodicMessages(messages, 0);
  // With budget 0, totalTokens > maxTokens, so compression kicks in
  assert.ok(selected.length > 0);
  assert.ok(selected.length <= messages.length);
});

test('selectEpisodicMessages: very small budget returns at least last episode', () => {
  const now = new Date();
  const gap = 10 * 60 * 1000;
  const messages = [
    msg('user', 'topic1 ' + 'x'.repeat(200), now.toISOString()),
    msg('assistant', 'answer1 ' + 'y'.repeat(200), new Date(now.getTime() + 1000).toISOString()),
    msg('user', 'topic2', new Date(now.getTime() + gap).toISOString()),
    msg('assistant', 'answer2', new Date(now.getTime() + gap + 1000).toISOString())
  ];
  const selected = selectEpisodicMessages(messages, 50);
  assert.ok(selected.length > 0);
  // Last episode messages should be present
  const lastMsg = selected[selected.length - 1];
  assert.ok(lastMsg.parts[0].text.includes('answer2') || lastMsg.parts[0].text.includes('topic2'));
});

test('selectEpisodicMessages: budget larger than all messages returns everything', () => {
  const now = new Date();
  const messages = [
    msg('user', 'hi', now.toISOString()),
    msg('assistant', 'hello', new Date(now.getTime() + 1000).toISOString()),
    msg('user', 'bye', new Date(now.getTime() + 2000).toISOString())
  ];
  const selected = selectEpisodicMessages(messages, 1_000_000);
  assert.equal(selected.length, messages.length);
});

test('selectEpisodicMessages: messages with tool calls are handled', () => {
  const now = new Date();
  const gap = 10 * 60 * 1000;
  const messages = [
    msg('user', 'build', now.toISOString()),
    msgWithTool('assistant', 'write_file', new Date(now.getTime() + 1000).toISOString()),
    {
      id: 'tool1',
      sessionId: 'test-session',
      role: 'tool',
      parts: [{ type: 'tool_result', name: 'write_file', content: 'created', ok: true }],
      createdAt: new Date(now.getTime() + 2000).toISOString()
    },
    msg('user', 'test', new Date(now.getTime() + gap).toISOString()),
    msgWithTool('assistant', 'run_tests', new Date(now.getTime() + gap + 1000).toISOString()),
    {
      id: 'tool2',
      sessionId: 'test-session',
      role: 'tool',
      parts: [{ type: 'tool_result', name: 'run_tests', content: 'all pass', ok: true }],
      createdAt: new Date(now.getTime() + gap + 2000).toISOString()
    }
  ];
  const selected = selectEpisodicMessages(messages, 1_000_000);
  assert.equal(selected.length, messages.length);
});

test('selectEpisodicMessages: single episode under minRecent returns all', () => {
  const now = new Date();
  const messages = [
    msg('user', 'hello', now.toISOString()),
    msg('assistant', 'hi', new Date(now.getTime() + 1000).toISOString())
  ];
  const selected = selectEpisodicMessages(messages, 100);
  assert.equal(selected.length, 2);
});

test('selectEpisodicMessages: respects minRecentMessages option', () => {
  const now = new Date();
  const gap = 10 * 60 * 1000;
  const messages = [];
  // 3 episodes each with 4 messages
  for (let ep = 0; ep < 3; ep++) {
    const base = now.getTime() + ep * gap;
    for (let i = 0; i < 4; i++) {
      const role = i % 2 === 0 ? 'user' : 'assistant';
      messages.push(msg(role, `ep${ep}-msg${i} ${'z'.repeat(100)}`, new Date(base + i * 1000).toISOString()));
    }
  }
  const selected = selectEpisodicMessages(messages, 200, { minRecentMessages: 4 });
  assert.ok(selected.length >= 4);
});

// -- estimateEpisodicCompression extras --

test('estimateEpisodicCompression: single message returns 1 episode', () => {
  const result = estimateEpisodicCompression([msg('user', 'hello')], 100_000);
  assert.equal(result.episodeCount, 1);
  assert.ok(result.originalTokens > 0);
  assert.ok(result.selectedTokens > 0);
});

test('estimateEpisodicCompression: large conversation compresses', () => {
  const now = new Date();
  const gap = 10 * 60 * 1000;
  const messages = [];
  for (let ep = 0; ep < 10; ep++) {
    const base = now.getTime() + ep * gap;
    messages.push(msg('user', `Episode ${ep}: ${'question '.repeat(50)}`, new Date(base).toISOString()));
    messages.push(msg('assistant', `Answer ${ep}: ${'response '.repeat(50)}`, new Date(base + 1000).toISOString()));
  }
  const result = estimateEpisodicCompression(messages, 500);
  assert.ok(result.episodeCount >= 2);
  assert.ok(result.selectedTokens <= result.originalTokens);
});

test('estimateEpisodicCompression: selectedTokens <= originalTokens always', () => {
  const now = new Date();
  const messages = [];
  for (let i = 0; i < 5; i++) {
    messages.push(msg('user', `msg ${i}`, new Date(now.getTime() + i * 1000).toISOString()));
  }
  const result = estimateEpisodicCompression(messages, 100_000);
  assert.ok(result.selectedTokens <= result.originalTokens);
});
