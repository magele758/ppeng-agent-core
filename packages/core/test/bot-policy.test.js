import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStateStore } from '../dist/storage.js';
import { RawAgentRuntime } from '../dist/runtime.js';
import { tryCreateDynToolStore } from '../dist/dyn-tools/store.js';
import { ValidationError } from '../dist/errors.js';
import {
  botPolicyWarnings,
  botToolAllowlistWarnings,
  createBot,
  openBot,
  updateBot
} from '../dist/bots/index.js';
import { setPermissionMode, getPermissionMode } from '../dist/runtime/session-facade.js';
import { spawnSubagent, spawnTeammate } from '../dist/runtime/spawn-host.js';
import { PromptBuilder } from '../dist/model/prompt-builder.js';
import { resolveSkillLoad, resolveSkillSearch } from '../dist/runtime/skill-load.js';
import { normalizeAllowedSkillNames } from '../dist/skills/skill-allowlist.js';
import { parseSessionMaxTurns, resolveSessionMaxTurns } from '../dist/runtime/session-max-turns.js';
import { normalizeAllowedToolNames } from '../dist/bots/bot-policy.js';
import { filterToolsForSession, resolveTurnTools } from '../dist/turn/resolve-turn-tools.js';

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'bot-policy-'));
  return new SqliteStateStore(join(dir, 'state.db'));
}

function facadeHost(store) {
  return {
    store,
    runImageRetention: async () => {},
    wakeAllAutonomousSessions: () => {},
    wakeAgentSessions: () => {}
  };
}

function parentSession(store, metadata) {
  store.upsertAgent({
    id: 'general',
    name: 'General',
    role: 'general',
    instructions: '',
    capabilities: []
  });
  const session = store.createSession({
    title: 'parent',
    mode: 'chat',
    agentId: 'general',
    metadata
  });
  store.upsertSessionMemory({ sessionId: session.id, scope: 'scratch', key: 'alpha', value: 'A' });
  store.upsertSessionMemory({ sessionId: session.id, scope: 'scratch', key: 'beta', value: 'B' });
  return store.getSession(session.id);
}

function scratchKeys(store, sessionId) {
  return store
    .listSessionMemory(sessionId, 'scratch')
    .map((row) => row.key)
    .sort();
}

async function spawnChild(store, session, opts) {
  await spawnSubagent(
    {
      store,
      repoRoot: '/tmp',
      stateDir: '/tmp',
      workspaceManager: {},
      sandbox: undefined,
      setSandbox() {},
      backgroundJobAborts: new Map(),
      async runSession(id) {
        return store.getSession(id);
      }
    },
    {
      repoRoot: '/tmp',
      stateDir: '/tmp',
      session,
      agent: {
        id: 'general',
        name: 'General',
        role: 'general',
        instructions: '',
        capabilities: []
      }
    },
    'do the thing',
    undefined,
    opts
  );
  const child = store.listSessions().find((item) => item.parentSessionId === session.id);
  assert.ok(child);
  return child;
}

test('bot spawn downgrades bypass and auto to ask and does not copy full scratch', async () => {
  const store = tempStore();
  const bypassParent = parentSession(store, {
    canonicalBotChat: true,
    botId: 'researcher',
    permissionMode: 'bypass'
  });
  const bypassChild = await spawnChild(store, bypassParent);
  assert.equal(bypassChild.metadata.permissionMode, 'ask');
  assert.deepEqual(scratchKeys(store, bypassChild.id), []);

  const autoParent = parentSession(store, {
    botId: 'researcher',
    permissionMode: 'auto'
  });
  const autoChild = await spawnChild(store, autoParent);
  assert.equal(autoChild.metadata.permissionMode, 'ask');
  assert.deepEqual(scratchKeys(store, autoChild.id), []);

  const askParent = parentSession(store, {
    canonicalBotChat: true,
    botId: 'researcher',
    permissionMode: 'ask'
  });
  const askChild = await spawnChild(store, askParent);
  assert.equal(askChild.metadata.permissionMode, 'ask');
  assert.deepEqual(scratchKeys(store, askChild.id), []);
  store.db.close();
});

test('bot spawn copies scratch only through a caller-supplied key filter', async () => {
  const store = tempStore();
  const parent = parentSession(store, {
    canonicalBotChat: true,
    botId: 'researcher',
    permissionMode: 'bypass'
  });
  const child = await spawnChild(store, parent, {
    scratchKeyFilter: (key) => key === 'alpha'
  });
  assert.equal(child.metadata.permissionMode, 'ask');
  assert.deepEqual(scratchKeys(store, child.id), ['alpha']);
  store.db.close();
});

test('non-bot spawn still inherits bypass and copies scratch', async () => {
  const store = tempStore();
  const parent = parentSession(store, { permissionMode: 'bypass' });
  const child = await spawnChild(store, parent);
  assert.equal(child.metadata.permissionMode, 'bypass');
  assert.deepEqual(scratchKeys(store, child.id), ['alpha', 'beta']);
  store.db.close();
});

test('maxTurns rejects illegal writes; the kernel resolver adopts 24, 48, 96 and falls back on bad stored values', () => {
  for (const bad of [0, -24, 10, 25, 100, 9999, 'nope', 24.5, true, null, []]) {
    assert.throws(() => parseSessionMaxTurns(bad), ValidationError);
    assert.equal(resolveSessionMaxTurns({ maxTurns: bad }, 24), 24);
    assert.equal(resolveSessionMaxTurns({ maxTurns: bad }, 7), 7);
  }
  assert.equal(parseSessionMaxTurns(24), 24);
  assert.equal(parseSessionMaxTurns('48'), 48);
  assert.equal(parseSessionMaxTurns(96), 96);
  assert.equal(resolveSessionMaxTurns(undefined, 24), 24);
  assert.equal(resolveSessionMaxTurns({}, 24), 24);
  assert.equal(resolveSessionMaxTurns({ maxTurns: '' }, 24), 24);
  assert.equal(resolveSessionMaxTurns({ maxTurns: 48 }, 24), 48);
  assert.equal(resolveSessionMaxTurns({ maxTurns: 96 }, 7), 96);
});

test('allowedTools rejects unknown names; empty keeps the full tool set', () => {
  const store = tempStore();
  const host = facadeHost(store);
  const bot = createBot(host, { name: 'Tools' });
  const catalog = [{ name: 'read_file' }, { name: 'bash' }];
  assert.throws(
    () => updateBot(host, bot.id, { allowedTools: ['nope'] }, { toolCatalog: catalog }),
    ValidationError
  );
  assert.equal(store.getSession(bot.canonicalSessionId).metadata.allowedTools, undefined);

  updateBot(host, bot.id, { allowedTools: ['read_file'] }, { toolCatalog: catalog });
  assert.deepEqual(store.getSession(bot.canonicalSessionId).metadata.allowedTools, ['read_file']);
  assert.deepEqual(store.getAgent(bot.id).allowedTools, ['read_file']);

  updateBot(host, bot.id, { maxTurns: 48, allowedTools: [] }, { toolCatalog: catalog });
  assert.equal(store.getSession(bot.canonicalSessionId).metadata.maxTurns, 48);
  assert.deepEqual(store.getSession(bot.canonicalSessionId).metadata.allowedTools, []);
  assert.equal(store.getAgent(bot.id).allowedTools, undefined);

  const kept = filterToolsForSession({
    env: {},
    tools: [{ name: 'read_file' }, { name: 'bash' }],
    agent: store.getAgent(bot.id),
    session: store.getSession(bot.canonicalSessionId)
  });
  assert.deepEqual(
    kept.tools.map((tool) => tool.name),
    ['read_file', 'bash']
  );

  updateBot(host, bot.id, { allowedTools: ['bash'] }, { toolCatalog: catalog });
  const narrowed = filterToolsForSession({
    env: {},
    tools: [{ name: 'read_file' }, { name: 'bash' }],
    agent: store.getAgent(bot.id),
    session: store.getSession(bot.canonicalSessionId)
  });
  assert.deepEqual(
    narrowed.tools.map((tool) => tool.name),
    ['bash']
  );

  const userChat = openBot(host, bot.id, { userId: 'user_a' });
  const copied = store.getSession(userChat.sessionId);
  assert.equal(copied.metadata.permissionMode, 'auto');
  assert.equal(copied.metadata.maxTurns, 48);
  assert.deepEqual(copied.metadata.allowedTools, ['bash']);
  store.db.close();
});

test('updateBot rejects an illegal maxTurns before writing it', () => {
  const store = tempStore();
  const host = facadeHost(store);
  const bot = createBot(host, { name: 'Cap' });
  assert.throws(() => updateBot(host, bot.id, { maxTurns: 12 }), ValidationError);
  assert.equal(store.getSession(bot.canonicalSessionId).metadata.maxTurns, 24);
  store.db.close();
});

async function spawnMate(store, session) {
  await spawnTeammate(
    {
      store,
      repoRoot: '/tmp',
      stateDir: '/tmp',
      workspaceManager: {},
      sandbox: undefined,
      setSandbox() {},
      backgroundJobAborts: new Map(),
      async runSession(id) {
        return store.getSession(id);
      }
    },
    {
      repoRoot: '/tmp',
      stateDir: '/tmp',
      session,
      agent: { id: 'general', name: 'General', role: 'general', instructions: '', capabilities: [] }
    },
    { name: `mate-${session.id.slice(-6)}`, role: 'helper', prompt: 'help' }
  );
  const child = store.listSessions().find((item) => item.parentSessionId === session.id);
  assert.ok(child);
  return child;
}

test('bot teammate: no full scratch copy; bypass/auto drop to ask, plan/ask stay', async () => {
  const store = tempStore();
  for (const [parentMode, expected] of [
    ['bypass', 'ask'],
    ['auto', 'ask'],
    ['ask', 'ask'],
    ['plan', 'plan']
  ]) {
    const parent = parentSession(store, {
      canonicalBotChat: true,
      botId: 'researcher',
      permissionMode: parentMode
    });
    const child = await spawnMate(store, parent);
    assert.equal(child.metadata.permissionMode, expected, `parent ${parentMode}`);
    assert.deepEqual(scratchKeys(store, child.id), []);
  }
  store.db.close();
});

test('non-bot teammate is unchanged: full scratch copy, no inherited permissionMode', async () => {
  const store = tempStore();
  const parent = parentSession(store, { permissionMode: 'bypass' });
  const child = await spawnMate(store, parent);
  assert.equal(child.metadata.permissionMode, undefined);
  assert.deepEqual(scratchKeys(store, child.id), ['alpha', 'beta']);
  store.db.close();
});

test('openBot keeps bypass / ask / plan on the per-user branch and on an existing canonical chat', () => {
  const store = tempStore();
  const host = facadeHost(store);
  for (const mode of ['bypass', 'ask', 'plan']) {
    const bot = createBot(host, { name: `Keep ${mode}` });
    const userFirst = openBot(host, bot.id, { userId: `user_${mode}` });
    const prior = store.getSession(userFirst.sessionId);
    store.updateSession(prior.id, { metadata: { ...prior.metadata, permissionMode: mode } });
    const again = openBot(host, bot.id, { userId: `user_${mode}` });
    assert.equal(again.sessionId, userFirst.sessionId);
    assert.equal(store.getSession(again.sessionId).metadata.permissionMode, mode);

    const canonical = store.getSession(bot.canonicalSessionId);
    store.updateSession(canonical.id, {
      metadata: { ...canonical.metadata, permissionMode: mode }
    });
    openBot(host, bot.id);
    assert.equal(store.getSession(bot.canonicalSessionId).metadata.permissionMode, mode);
  }
  store.db.close();
});

test('a recreated canonical chat is auto again, and keeps the saved turn cap and allowlists', () => {
  const store = tempStore();
  const host = facadeHost(store);
  const bot = createBot(host, { name: 'Recreate' });
  const catalog = [{ name: 'bash' }];
  updateBot(host, bot.id, { maxTurns: 96, allowedTools: ['bash'] }, { toolCatalog: catalog });
  const userChat = openBot(host, bot.id, { userId: 'user_r' });
  const session = store.getSession(userChat.sessionId);
  assert.equal(session.metadata.permissionMode, 'auto');
  assert.equal(session.metadata.maxTurns, 96);
  assert.deepEqual(session.metadata.allowedTools, ['bash']);
  store.db.close();
});

test('allowedTools rejects non-array input and non-string entries', () => {
  const store = tempStore();
  const host = facadeHost(store);
  const bot = createBot(host, { name: 'Strict' });
  const catalog = [{ name: 'bash' }];
  assert.throws(
    () => updateBot(host, bot.id, { allowedTools: 'bash' }, { toolCatalog: catalog }),
    ValidationError
  );
  assert.throws(
    () => updateBot(host, bot.id, { allowedTools: ['bash', 7] }, { toolCatalog: catalog }),
    ValidationError
  );
  assert.throws(() => updateBot(host, bot.id, { allowedTools: ['bash'] }), ValidationError);
  store.db.close();
});

const SKILL_A = {
  id: 'allow-alpha',
  name: 'Allow Alpha Playbook',
  description: 'alpha-unique-topic playbook',
  content: 'Alpha body.',
  source: 'workspace'
};
const SKILL_B = {
  id: 'allow-beta',
  name: 'Allow Beta Playbook',
  description: 'beta-unique-topic playbook',
  content: 'Beta body.',
  source: 'workspace'
};

test('allowedSkills: validated on save, filters the shortlist and search, and gates load_skill', async () => {
  const saved = process.env.RAW_AGENT_AGENTS_SKILLS;
  process.env.RAW_AGENT_AGENTS_SKILLS = '0';
  try {
    const store = tempStore();
    const host = facadeHost(store);
    const bot = createBot(host, { name: 'Skilled' });
    const builder = new PromptBuilder({
      store,
      repoRoot: '/nonexistent-repo-root-xyz',
      extraSkills: [SKILL_A, SKILL_B]
    });
    const catalog = await builder.allSkills();

    assert.throws(
      () => updateBot(host, bot.id, { allowedSkills: ['nope'] }, { toolCatalog: [], skillCatalog: catalog }),
      ValidationError
    );
    assert.throws(() => updateBot(host, bot.id, { allowedSkills: ['x'] }), ValidationError);
    assert.deepEqual(
      normalizeAllowedSkillNames(['allow alpha playbook', 'Allow Alpha Playbook'], catalog),
      ['Allow Alpha Playbook']
    );

    const sid = bot.canonicalSessionId;
    const traces = [];
    const skillHost = { promptBuilder: builder, emitTrace: (_s, event) => traces.push(event) };

    const open = await resolveSkillSearch(skillHost, 'unique-topic playbook', sid, 20);
    const openNames = JSON.parse(open.content).hits.map((hit) => hit.name);
    assert.ok(openNames.includes(SKILL_A.name) && openNames.includes(SKILL_B.name));
    assert.ok((await resolveSkillLoad(skillHost, SKILL_B.name, sid)).content);

    updateBot(
      host,
      bot.id,
      { allowedSkills: [SKILL_A.name] },
      { toolCatalog: [], skillCatalog: catalog }
    );
    assert.deepEqual(store.getSession(sid).metadata.allowedSkills, [SKILL_A.name]);

    const search = await resolveSkillSearch(skillHost, 'unique-topic playbook', sid, 20);
    const names = JSON.parse(search.content).hits.map((hit) => hit.name);
    assert.ok(names.includes(SKILL_A.name));
    assert.ok(!names.includes(SKILL_B.name));

    const ctx = {
      agent: store.getAgent(bot.id),
      session: store.getSession(sid),
      repoRoot: '/nonexistent-repo-root-xyz'
    };
    const userMsg = {
      id: 'm1',
      sessionId: sid,
      role: 'user',
      createdAt: new Date().toISOString(),
      parts: [{ type: 'text', text: 'alpha-unique-topic beta-unique-topic' }]
    };
    const dynamic = await builder.buildDynamicContext(ctx, [userMsg]);
    assert.ok(dynamic.includes(SKILL_A.name));
    assert.ok(!dynamic.includes(SKILL_B.name));

    assert.ok((await resolveSkillLoad(skillHost, SKILL_A.name, sid)).content);
    const blocked = await resolveSkillLoad(skillHost, SKILL_B.name, sid);
    assert.equal(blocked.content, undefined);
    assert.match(blocked.error, /not enabled/);
    assert.ok(traces.some((event) => event.payload?.reason === 'not_in_allowed_skills'));

    updateBot(host, bot.id, { allowedSkills: [] }, { toolCatalog: [], skillCatalog: catalog });
    assert.ok((await resolveSkillLoad(skillHost, SKILL_B.name, sid)).content);
    store.db.close();
  } finally {
    if (saved === undefined) delete process.env.RAW_AGENT_AGENTS_SKILLS;
    else process.env.RAW_AGENT_AGENTS_SKILLS = saved;
  }
});

test('allowedTools warnings name missing required tools; empty and complete lists are silent', () => {
  assert.deepEqual(botToolAllowlistWarnings(undefined), []);
  assert.deepEqual(botToolAllowlistWarnings([]), []);
  assert.deepEqual(botToolAllowlistWarnings(['TodoWrite', 'load_skill', 'message_agent', 'bash']), []);
  assert.deepEqual(botToolAllowlistWarnings(['bash']), [
    { code: 'missing_required_tools', tools: ['TodoWrite', 'load_skill', 'message_agent'] }
  ]);
  assert.deepEqual(botToolAllowlistWarnings(['TodoWrite', 'load_skill']), [
    { code: 'missing_required_tools', tools: ['message_agent'] }
  ]);
});

test('botPolicyWarnings is recomputed from stored session metadata, not from the last save', () => {
  const store = tempStore();
  const host = facadeHost(store);
  const bot = createBot(host, { name: 'Warn' });
  const catalog = [{ name: 'read_file' }, { name: 'TodoWrite' }, { name: 'load_skill' }];
  const read = () => botPolicyWarnings(store.getSession(bot.canonicalSessionId).metadata);
  assert.deepEqual(read(), []);
  updateBot(host, bot.id, { allowedTools: ['read_file'] }, { toolCatalog: catalog });
  assert.deepEqual(read(), [
    { code: 'missing_required_tools', tools: ['TodoWrite', 'load_skill', 'message_agent'] }
  ]);
  updateBot(host, bot.id, { allowedTools: [] }, { toolCatalog: catalog });
  assert.deepEqual(read(), []);
  store.db.close();
});

test('allowedTools save accepts MCP names that are not registered yet, but still rejects unknown built-ins', () => {
  const store = tempStore();
  const host = facadeHost(store);
  const bot = createBot(host, { name: 'Mcp' });
  const catalog = [{ name: 'read_file' }];
  assert.deepEqual(
    normalizeAllowedToolNames(
      ['read_file', 'mcp_s0_search', 'mcp_h12_get-doc', 'mcp_invoke', 'mcp_read_resource'],
      catalog
    ),
    ['read_file', 'mcp_s0_search', 'mcp_h12_get-doc', 'mcp_invoke', 'mcp_read_resource']
  );
  for (const bad of ['mcp_', 'mcp_x0_foo', 'mcp_s_foo', 'mcp_s0_', 'mcp_other']) {
    assert.throws(() => normalizeAllowedToolNames([bad], catalog), ValidationError, bad);
  }
  updateBot(host, bot.id, { allowedTools: ['read_file', 'mcp_s0_search'] }, { toolCatalog: catalog });
  assert.deepEqual(store.getSession(bot.canonicalSessionId).metadata.allowedTools, [
    'read_file',
    'mcp_s0_search'
  ]);
  assert.throws(
    () => updateBot(host, bot.id, { allowedTools: ['nope'] }, { toolCatalog: catalog }),
    ValidationError
  );
  store.db.close();
});

test('stale_allowed_tools lists names that are neither registered, MCP-shaped, nor saved dynamic tools', () => {
  const ctx = { registeredToolNames: ['read_file', 'TodoWrite', 'load_skill', 'message_agent'], dynToolNames: ['live_fn'] };
  assert.deepEqual(botToolAllowlistWarnings(['read_file', 'TodoWrite', 'load_skill', 'message_agent', 'live_fn'], ctx), []);
  assert.deepEqual(
    botToolAllowlistWarnings(['read_file', 'TodoWrite', 'load_skill', 'message_agent', 'gone_fn', 'live_fn', 'old_fn'], ctx),
    [{ code: 'stale_allowed_tools', tools: ['gone_fn', 'old_fn'] }]
  );
  assert.deepEqual(
    botToolAllowlistWarnings(['gone_fn'], ctx).map((w) => w.code),
    ['missing_required_tools', 'stale_allowed_tools']
  );
  assert.deepEqual(
    botToolAllowlistWarnings(['read_file', 'TodoWrite', 'load_skill', 'message_agent', 'mcp_s0_search', 'mcp_invoke'], ctx),
    []
  );
  assert.deepEqual(botToolAllowlistWarnings(['gone_fn']).map((w) => w.code), ['missing_required_tools']);
  assert.deepEqual(
    botToolAllowlistWarnings(['gone_fn'], { registeredToolNames: ctx.registeredToolNames }).map((w) => w.code),
    ['missing_required_tools']
  );
  assert.deepEqual(botToolAllowlistWarnings([], ctx), []);
});

test('missing_required_tools flags unverified MCP names but stays a warning with the same tools', () => {
  const registered = ['TodoWrite', 'mcp_h1_fetch'];
  assert.deepEqual(botToolAllowlistWarnings(['mcp_s0_search', 'mcp_invoke']), [
    {
      code: 'missing_required_tools',
      tools: ['TodoWrite', 'load_skill', 'message_agent'],
      unverifiedMcpTools: ['mcp_s0_search', 'mcp_invoke']
    }
  ]);
  assert.deepEqual(
    botToolAllowlistWarnings(['mcp_s0_search', 'mcp_h1_fetch', 'TodoWrite'], { registeredToolNames: registered }),
    [
      {
        code: 'missing_required_tools',
        tools: ['load_skill', 'message_agent'],
        unverifiedMcpTools: ['mcp_s0_search']
      }
    ]
  );
  assert.deepEqual(botToolAllowlistWarnings(['mcp_h1_fetch'], { registeredToolNames: registered }), [
    { code: 'missing_required_tools', tools: ['TodoWrite', 'load_skill', 'message_agent'] }
  ]);
  assert.deepEqual(botToolAllowlistWarnings(['bash']), [
    { code: 'missing_required_tools', tools: ['TodoWrite', 'load_skill', 'message_agent'] }
  ]);
});

test('runtime.getBotPolicyWarnings drops a dynamic tool from stale once it is registered, and flags it after it is retired', () => {
  const rt = new RawAgentRuntime({
    repoRoot: mkdtempSync(join(tmpdir(), 'bot-stale-repo-')),
    stateDir: mkdtempSync(join(tmpdir(), 'bot-stale-state-'))
  });
  const bot = rt.createBot({ name: 'Stale' });
  const dyn = tryCreateDynToolStore(rt.store);
  dyn.upsert({
    name: 'add_one',
    description: 'adds one',
    source: { code: 'return input.n + 1' },
    sessionId: bot.canonicalSessionId,
    status: 'active'
  });
  rt.updateBot(bot.id, { allowedTools: ['read_file', 'add_one'] });
  const codes = () => rt.getBotPolicyWarnings(bot.id);
  assert.deepEqual(codes().map((w) => w.code), ['missing_required_tools']);

  dyn.retire('add_one', bot.canonicalSessionId);
  assert.deepEqual(codes().find((w) => w.code === 'stale_allowed_tools'), {
    code: 'stale_allowed_tools',
    tools: ['add_one']
  });
  assert.deepEqual(rt.getSession(bot.canonicalSessionId).metadata.allowedTools, ['read_file', 'add_one']);

  const stale = codes().find((w) => w.code === 'stale_allowed_tools').tools;
  const kept = rt.getSession(bot.canonicalSessionId).metadata.allowedTools.filter((n) => !stale.includes(n));
  rt.updateBot(bot.id, { allowedTools: kept });
  assert.equal(codes().some((w) => w.code === 'stale_allowed_tools'), false);
  assert.deepEqual(rt.getBotPolicyWarnings('missing-bot'), []);
  rt.store.db.close();
});

test('permissionMode round-trips through setPermissionMode on all five tiers and survives openBot', () => {
  const store = tempStore();
  const host = facadeHost(store);
  const bot = createBot(host, { name: 'Tiers' });
  for (const mode of ['plan', 'ask', 'acceptEdits', 'auto', 'bypass']) {
    setPermissionMode(store, bot.canonicalSessionId, { mode });
    assert.equal(getPermissionMode(store, bot.canonicalSessionId), mode);
    openBot(host, bot.id);
    assert.equal(store.getSession(bot.canonicalSessionId).metadata.permissionMode, mode);
  }
  assert.throws(
    () => setPermissionMode(store, bot.canonicalSessionId, { mode: 'root' }),
    ValidationError
  );
  assert.equal(store.getSession(bot.canonicalSessionId).metadata.permissionMode, 'bypass');
  store.db.close();
});

function stubTool(name) {
  return {
    name,
    description: name,
    inputSchema: {},
    approvalMode: 'never',
    sideEffectLevel: 'none',
    execute: async () => ({ ok: true, content: '' })
  };
}

function resolveNames(store, bot, sessionId, { tools, dynTools }) {
  const session = store.getSession(sessionId);
  return resolveTurnTools({
    env: {},
    tools,
    agent: store.getAgent(bot.id),
    session,
    sessionId: session.id,
    systemPromptChars: 10,
    dynTools
  }).turnTools.map((tool) => tool.name);
}

test('non-empty allowedTools also constrains MCP and PTC dynamic tools; empty keeps everything', () => {
  const store = tempStore();
  const host = facadeHost(store);
  const bot = createBot(host, { name: 'Gate' });
  const catalog = [{ name: 'read_file' }, { name: 'bash' }];
  const processTools = [
    stubTool('read_file'),
    stubTool('bash'),
    stubTool('mcp_s0_search'),
    stubTool('mcp_h1_fetch'),
    stubTool('message_agent')
  ];
  const dynTools = [stubTool('add_one'), stubTool('listed_fn')];

  assert.deepEqual(
    resolveNames(store, bot, bot.canonicalSessionId, { tools: processTools, dynTools }).sort(),
    ['add_one', 'bash', 'listed_fn', 'mcp_h1_fetch', 'mcp_s0_search', 'message_agent', 'read_file']
  );

  updateBot(host, bot.id, { allowedTools: ['read_file'] }, { toolCatalog: catalog });
  assert.deepEqual(
    resolveNames(store, bot, bot.canonicalSessionId, { tools: processTools, dynTools }),
    ['read_file']
  );

  updateBot(
    host,
    bot.id,
    { allowedTools: ['read_file', 'mcp_s0_search', 'listed_fn'] },
    { toolCatalog: catalog, dynToolNames: ['listed_fn'] }
  );
  assert.throws(
    () => updateBot(host, bot.id, { allowedTools: ['listed_fn'] }, { toolCatalog: catalog }),
    ValidationError
  );
  assert.deepEqual(
    resolveNames(store, bot, bot.canonicalSessionId, { tools: processTools, dynTools }).sort(),
    ['listed_fn', 'mcp_s0_search', 'read_file']
  );

  updateBot(host, bot.id, { allowedTools: [] }, { toolCatalog: catalog });
  assert.equal(
    resolveNames(store, bot, bot.canonicalSessionId, { tools: processTools, dynTools }).length,
    7
  );
  store.db.close();
});

test('message_agent stays canonical-only with an allowlist that lists it, for static and dynamic tools', () => {
  const store = tempStore();
  const host = facadeHost(store);
  const bot = createBot(host, { name: 'Canon' });
  updateBot(
    host,
    bot.id,
    { allowedTools: ['read_file', 'message_agent'] },
    { toolCatalog: [{ name: 'read_file' }, { name: 'message_agent' }] }
  );
  const plain = store.createSession({
    title: 'Plain',
    mode: 'chat',
    agentId: bot.id,
    metadata: { allowedTools: ['read_file', 'message_agent'] }
  });
  const tools = [stubTool('read_file'), stubTool('message_agent')];
  const dynTools = [stubTool('message_agent')];

  assert.deepEqual(
    resolveNames(store, bot, bot.canonicalSessionId, { tools, dynTools }).sort(),
    ['message_agent', 'read_file']
  );
  assert.deepEqual(resolveNames(store, bot, plain.id, { tools, dynTools }), ['read_file']);
  store.db.close();
});
