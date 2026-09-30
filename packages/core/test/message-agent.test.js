import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStateStore } from '../dist/storage.js';
import { createBot } from '../dist/bots/index.js';
import { filterToolsForSession, resolveTurnTools } from '../dist/turn/resolve-turn-tools.js';
import {
  createMessageAgentTool,
  formatBotMessage,
  MESSAGE_AGENT_TOOL_NAME,
  MESSAGE_MAX_CHARS
} from '../dist/tools/message-agent.js';

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'message-agent-'));
  const store = new SqliteStateStore(join(dir, 'state.db'));
  return { dir, store };
}

function facadeHost(store) {
  return {
    store,
    runImageRetention: async () => {},
    wakeAllAutonomousSessions: () => {},
    wakeAgentSessions: () => {}
  };
}

function agentOf(bot) {
  return {
    id: bot.id,
    name: bot.name,
    role: 'Bot',
    instructions: '',
    capabilities: ['bot']
  };
}

function ctx(dir, session, bot) {
  return {
    repoRoot: dir,
    stateDir: dir,
    session,
    agent: agentOf(bot)
  };
}

function userText(store, sessionId) {
  return store
    .listMessages(sessionId)
    .filter((message) => message.role === 'user')
    .map((message) =>
      message.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('')
    );
}

function harness(store) {
  const runs = [];
  const tool = createMessageAgentTool({
    store,
    runSession: async (sessionId) => {
      runs.push(sessionId);
      return store.getSession(sessionId);
    },
    log: { debug() {}, info() {}, warn() {}, error() {} }
  });
  return { tool, runs };
}

test('non-bot and subagent sessions do not see message_agent', () => {
  const { store } = tempStore();
  const bot = createBot(facadeHost(store), { name: 'Alpha' });
  const canonical = store.getSession(bot.canonicalSessionId);
  const plain = store.createSession({
    title: 'Chat',
    mode: 'chat',
    agentId: 'general',
    metadata: {}
  });
  const sub = store.createSession({
    title: 'Sub',
    mode: 'subagent',
    agentId: bot.id,
    metadata: { canonicalBotChat: true, botId: bot.id }
  });
  const stub = {
    name: 'read_file',
    description: 'r',
    inputSchema: {},
    approvalMode: 'never',
    sideEffectLevel: 'none',
    execute: async () => ({ ok: true, content: '' })
  };
  const messageTool = {
    name: MESSAGE_AGENT_TOOL_NAME,
    description: 'm',
    inputSchema: {},
    approvalMode: 'never',
    sideEffectLevel: 'none',
    execute: async () => ({ ok: true, content: '' })
  };
  const tools = [stub, messageTool];
  const env = {};
  const agent = agentOf(bot);

  const plainFiltered = filterToolsForSession({ env, tools, agent, session: plain });
  assert.deepEqual(
    plainFiltered.tools.map((tool) => tool.name),
    ['read_file']
  );

  const subFiltered = filterToolsForSession({ env, tools, agent, session: sub });
  assert.ok(!subFiltered.tools.some((tool) => tool.name === MESSAGE_AGENT_TOOL_NAME));

  const botFiltered = filterToolsForSession({ env, tools, agent, session: canonical });
  assert.ok(botFiltered.tools.some((tool) => tool.name === MESSAGE_AGENT_TOOL_NAME));

  const resolved = resolveTurnTools({
    env,
    tools,
    agent,
    session: plain,
    sessionId: plain.id,
    systemPromptChars: 10,
    dynTools: [messageTool]
  });
  assert.ok(!resolved.turnTools.some((tool) => tool.name === MESSAGE_AGENT_TOOL_NAME));
  store.db.close();
});

test('canonical bot delivers to a roster peer and starts a run', async () => {
  const { dir, store } = tempStore();
  const host = facadeHost(store);
  const alpha = createBot(host, { name: 'Alpha' });
  const beta = createBot(host, { name: 'Beta' });
  const { tool, runs } = harness(store);
  const sender = store.getSession(alpha.canonicalSessionId);
  const result = await tool.execute(ctx(dir, sender, alpha), {
    target: 'Beta',
    message: 'please review the diff'
  });
  assert.equal(result.ok, true);
  const payload = JSON.parse(result.content);
  assert.equal(payload.delivered, true);
  assert.equal(payload.sessionId, beta.canonicalSessionId);
  assert.equal(payload.relayHop, 1);
  assert.equal(payload.startedRun, true);
  assert.deepEqual(userText(store, beta.canonicalSessionId), [
    formatBotMessage(alpha, 'please review the diff')
  ]);
  assert.equal(store.getSession(beta.canonicalSessionId).metadata.relayHop, 1);
  assert.deepEqual(runs, [beta.canonicalSessionId]);
  assert.equal(userText(store, alpha.canonicalSessionId).length, 0);
  store.db.close();
});

test('message_agent can target a roster id and a same-user canonical session', async () => {
  const { dir, store } = tempStore();
  const host = facadeHost(store);
  const alpha = createBot(host, { name: 'Alpha' });
  const beta = createBot(host, { name: 'Beta' });
  const sender = store.getSession(alpha.canonicalSessionId);
  store.updateSession(sender.id, {
    metadata: { ...sender.metadata, userId: 'user_a' }
  });
  const perUser = store.createSession({
    title: 'Bot Chat · Beta',
    mode: 'chat',
    agentId: beta.id,
    metadata: { botId: beta.id, canonicalBotChat: true, userId: 'user_a' }
  });
  const { tool, runs } = harness(store);
  const result = await tool.execute(ctx(dir, store.getSession(sender.id), alpha), {
    target: beta.id,
    message: 'check the quota'
  });
  assert.equal(result.ok, true);
  const payload = JSON.parse(result.content);
  assert.equal(payload.sessionId, perUser.id);
  assert.deepEqual(userText(store, perUser.id), [formatBotMessage(alpha, 'check the quota')]);
  assert.equal(userText(store, beta.canonicalSessionId).length, 0);
  assert.deepEqual(runs, [perUser.id]);
  store.db.close();
});

test('sending to yourself fails and writes nothing', async () => {
  const { dir, store } = tempStore();
  const host = facadeHost(store);
  const alpha = createBot(host, { name: 'Alpha' });
  createBot(host, { name: 'Beta' });
  const { tool, runs } = harness(store);
  const sender = store.getSession(alpha.canonicalSessionId);
  const result = await tool.execute(ctx(dir, sender, alpha), {
    target: 'Alpha',
    message: 'hello me'
  });
  assert.equal(result.ok, false);
  const payload = JSON.parse(result.content);
  assert.equal(payload.error_code, 'SELF_TARGET');
  assert.ok(payload.roster.includes('Beta'));
  assert.equal(userText(store, alpha.canonicalSessionId).length, 0);
  assert.deepEqual(runs, []);
  store.db.close();
});

test('relayHop >= 3 is rejected before write', async () => {
  const { dir, store } = tempStore();
  const host = facadeHost(store);
  const alpha = createBot(host, { name: 'Alpha' });
  const beta = createBot(host, { name: 'Beta' });
  const sender = store.getSession(alpha.canonicalSessionId);
  store.updateSession(sender.id, {
    metadata: { ...sender.metadata, relayHop: 3 }
  });
  const { tool, runs } = harness(store);
  const result = await tool.execute(ctx(dir, store.getSession(sender.id), alpha), {
    target: beta.id,
    message: 'keep going'
  });
  assert.equal(result.ok, false);
  const payload = JSON.parse(result.content);
  assert.equal(payload.error_code, 'HOP_LIMIT');
  assert.equal(payload.relayHop, 3);
  assert.equal(userText(store, beta.canonicalSessionId).length, 0);
  assert.equal(store.getSession(beta.canonicalSessionId).metadata.relayHop, undefined);
  assert.deepEqual(runs, []);
  store.db.close();
});

test('running target is not written and no parallel run starts', async () => {
  const { dir, store } = tempStore();
  const host = facadeHost(store);
  const alpha = createBot(host, { name: 'Alpha' });
  const beta = createBot(host, { name: 'Beta' });
  store.updateSession(beta.canonicalSessionId, { status: 'running' });
  const { tool, runs } = harness(store);
  const result = await tool.execute(ctx(dir, store.getSession(alpha.canonicalSessionId), alpha), {
    target: 'beta',
    message: 'ping'
  });
  assert.equal(result.ok, false);
  const payload = JSON.parse(result.content);
  assert.equal(payload.error_code, 'TARGET_BUSY');
  assert.equal(userText(store, beta.canonicalSessionId).length, 0);
  assert.equal(store.getSession(beta.canonicalSessionId).status, 'running');
  assert.deepEqual(runs, []);
  store.db.close();
});

test('calling message_agent outside a canonical bot chat is rejected', async () => {
  const { dir, store } = tempStore();
  const host = facadeHost(store);
  const alpha = createBot(host, { name: 'Alpha' });
  const beta = createBot(host, { name: 'Beta' });
  const plain = store.createSession({
    title: 'Chat',
    mode: 'chat',
    agentId: alpha.id,
    metadata: { botId: alpha.id }
  });
  const { tool, runs } = harness(store);
  const result = await tool.execute(ctx(dir, plain, alpha), {
    target: 'Beta',
    message: 'should not land'
  });
  assert.equal(result.ok, false);
  assert.equal(JSON.parse(result.content).error_code, 'NOT_CANONICAL');
  assert.equal(userText(store, beta.canonicalSessionId).length, 0);
  assert.deepEqual(runs, []);
  store.db.close();
});

test('unknown target returns a short roster and did_you_mean', async () => {
  const { dir, store } = tempStore();
  const host = facadeHost(store);
  const alpha = createBot(host, { name: 'Alpha' });
  createBot(host, { name: 'Researcher' });
  const { tool } = harness(store);
  const result = await tool.execute(ctx(dir, store.getSession(alpha.canonicalSessionId), alpha), {
    target: 'Reseacher',
    message: 'hi'
  });
  const payload = JSON.parse(result.content);
  assert.equal(payload.error_code, 'UNKNOWN_TARGET');
  assert.equal(payload.did_you_mean, 'Researcher');
  assert.ok(payload.roster.includes('Researcher'));
  assert.ok(payload.roster.length <= 8);
  assert.ok(!payload.roster.includes('Alpha'));
  store.db.close();
});

test('silence tokens and pure FYI are stored without starting a run', async () => {
  const { dir, store } = tempStore();
  const host = facadeHost(store);
  const alpha = createBot(host, { name: 'Alpha' });
  const beta = createBot(host, { name: 'Beta' });
  const { tool, runs } = harness(store);
  const sender = store.getSession(alpha.canonicalSessionId);
  const silent = await tool.execute(ctx(dir, sender, alpha), {
    target: 'Beta',
    message: '[SILENT]'
  });
  assert.equal(JSON.parse(silent.content).startedRun, false);
  assert.equal(JSON.parse(silent.content).skippedRun, 'silent');
  const fyi = await tool.execute(ctx(dir, store.getSession(sender.id), alpha), {
    target: 'Beta',
    message: 'FYI the deploy finished'
  });
  assert.equal(JSON.parse(fyi.content).skippedRun, 'fyi');
  assert.deepEqual(userText(store, beta.canonicalSessionId), [
    formatBotMessage(alpha, '[SILENT]'),
    formatBotMessage(alpha, 'FYI the deploy finished')
  ]);
  assert.deepEqual(runs, []);
  store.db.close();
});

test('background idle target is woken through the scheduler queue', async () => {
  const { dir, store } = tempStore();
  const host = facadeHost(store);
  const alpha = createBot(host, { name: 'Alpha' });
  const beta = createBot(host, { name: 'Beta' });
  store.updateSession(beta.canonicalSessionId, { background: true });
  const { tool, runs } = harness(store);
  const result = await tool.execute(ctx(dir, store.getSession(alpha.canonicalSessionId), alpha), {
    target: 'Beta',
    message: 'nightly digest'
  });
  assert.equal(JSON.parse(result.content).startedRun, true);
  assert.deepEqual(runs, []);
  assert.deepEqual(store.dequeueSchedulerWakes(), [beta.canonicalSessionId]);
  store.db.close();
});

test('overlong messages are rejected', async () => {
  const { dir, store } = tempStore();
  const host = facadeHost(store);
  const alpha = createBot(host, { name: 'Alpha' });
  const beta = createBot(host, { name: 'Beta' });
  const { tool } = harness(store);
  const result = await tool.execute(ctx(dir, store.getSession(alpha.canonicalSessionId), alpha), {
    target: 'Beta',
    message: 'x'.repeat(MESSAGE_MAX_CHARS + 1)
  });
  assert.equal(JSON.parse(result.content).error_code, 'MESSAGE_TOO_LONG');
  assert.equal(userText(store, beta.canonicalSessionId).length, 0);
  store.db.close();
});
