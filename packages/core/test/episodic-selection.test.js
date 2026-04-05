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
