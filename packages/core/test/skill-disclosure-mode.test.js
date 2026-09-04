import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { PromptBuilder } = await import('../dist/model/prompt-builder.js');
const { writeSkillSettings } = await import('../dist/skills/skill-settings.js');
const { resolveSkillLoad, resolveSkillSearch } = await import('../dist/runtime/skill-load.js');
const { createBuiltinTools } = await import('../dist/tools/builtin-tools.js');

const ZEBRA = {
  id: 'unique-zebra-xy',
  name: 'Zebra Routing Unique',
  description: 'Unique zebra routing playbook for xy-test-query',
  content: 'Zebra routing body for tests.',
  source: 'workspace'
};

function kvStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getDaemonControl(key) {
      return map.get(key);
    },
    setDaemonControl(key, value) {
      map.set(key, value);
    },
    listSessionMemory() {
      return [];
    }
  };
}

function makeCtx() {
  return {
    agent: {
      id: 'test-agent',
      name: 'TestBot',
      role: 'assistant',
      instructions: 'Be helpful.',
      capabilities: []
    },
    session: {
      id: 'sess-skill',
      mode: 'chat',
      todo: [],
      summary: ''
    },
    repoRoot: '/nonexistent-repo-root-xyz'
  };
}

function makeBuilder(store) {
  return new PromptBuilder({
    store,
    repoRoot: '/nonexistent-repo-root-xyz',
    extraSkills: [ZEBRA]
  });
}

function traces() {
  const events = [];
  return {
    events,
    emitTrace(_sessionId, event) {
      events.push(event);
    }
  };
}

describe('skill disclosure modes', () => {
  it('shortlist (default) lists routing; lazy hides catalog; full lists all', async () => {
    const savedAgents = process.env.RAW_AGENT_AGENTS_SKILLS;
    const savedRouting = process.env.RAW_AGENT_SKILL_ROUTING_MODE;
    process.env.RAW_AGENT_AGENTS_SKILLS = '0';
    delete process.env.RAW_AGENT_SKILL_ROUTING_MODE;
    try {
      const store = kvStore();
      const pb = makeBuilder(store);
      const ctx = makeCtx();
      const user = {
        id: 'u1',
        sessionId: ctx.session.id,
        role: 'user',
        parts: [{ type: 'text', text: 'help me plan todos' }],
        createdAt: new Date().toISOString()
      };

      const shortlist = await pb.buildDynamicContext(ctx, [user]);
      assert.ok(shortlist.includes('Skill routing'));
      assert.ok(!shortlist.includes('Skill disclosure (lazy)'));

      writeSkillSettings(store, { disclosureMode: 'lazy' });
      const lazy = await pb.buildDynamicContext(ctx, [user]);
      assert.ok(lazy.includes('Skill disclosure (lazy)'));
      assert.ok(lazy.includes('search_skills'));
      assert.ok(!lazy.includes('Skill routing'));
      assert.ok(!lazy.includes('Zebra Routing Unique'));

      writeSkillSettings(store, { disclosureMode: 'full' });
      const full = await pb.buildDynamicContext(ctx, [user]);
      assert.ok(full.includes('Available skills:'));
      assert.ok(full.includes('Zebra Routing Unique'));
    } finally {
      if (savedAgents === undefined) delete process.env.RAW_AGENT_AGENTS_SKILLS;
      else process.env.RAW_AGENT_AGENTS_SKILLS = savedAgents;
      if (savedRouting === undefined) delete process.env.RAW_AGENT_SKILL_ROUTING_MODE;
      else process.env.RAW_AGENT_SKILL_ROUTING_MODE = savedRouting;
    }
  });

  it('searchSkills ranks extra skill and records names for strict lazy load', async () => {
    const savedAgents = process.env.RAW_AGENT_AGENTS_SKILLS;
    const savedStrict = process.env.RAW_AGENT_SKILL_LOAD_STRICT;
    const savedRouting = process.env.RAW_AGENT_SKILL_ROUTING_MODE;
    process.env.RAW_AGENT_AGENTS_SKILLS = '0';
    process.env.RAW_AGENT_SKILL_LOAD_STRICT = '1';
    process.env.RAW_AGENT_SKILL_ROUTING_MODE = 'hybrid';
    try {
      const store = kvStore();
      writeSkillSettings(store, { disclosureMode: 'lazy' });
      const pb = makeBuilder(store);
      const host = { promptBuilder: pb, ...traces() };

      const before = await resolveSkillLoad(host, ZEBRA.name, 'sess-skill');
      assert.ok(before.error && before.error.includes('search_skills'));

      const search = await resolveSkillSearch(host, 'xy-test-query zebra', 'sess-skill', 8);
      const parsed = JSON.parse(search.content);
      assert.ok(parsed.hits.some((h) => h.name === ZEBRA.name));

      const loaded = await resolveSkillLoad(host, ZEBRA.name, 'sess-skill');
      assert.ok(loaded.content);
      assert.ok(loaded.content.includes('Zebra routing body'));
    } finally {
      if (savedAgents === undefined) delete process.env.RAW_AGENT_AGENTS_SKILLS;
      else process.env.RAW_AGENT_AGENTS_SKILLS = savedAgents;
      if (savedStrict === undefined) delete process.env.RAW_AGENT_SKILL_LOAD_STRICT;
      else process.env.RAW_AGENT_SKILL_LOAD_STRICT = savedStrict;
      if (savedRouting === undefined) delete process.env.RAW_AGENT_SKILL_ROUTING_MODE;
      else process.env.RAW_AGENT_SKILL_ROUTING_MODE = savedRouting;
    }
  });

  it('exposes search_skills builtin tool', async () => {
    const tools = createBuiltinTools({
      loadSkill: async () => ({ content: '' }),
      searchSkills: async () => ({ content: '{"hits":[]}' })
    });
    const names = tools.map((t) => t.name);
    assert.ok(names.includes('search_skills'));
    assert.ok(names.includes('load_skill'));
  });
});
