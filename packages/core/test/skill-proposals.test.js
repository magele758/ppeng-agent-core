import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SKILL_PROPOSAL_BODY_MAX,
  SKILL_PROPOSAL_MAX_PENDING,
  SkillProposalStore,
  buildSkillProposeReminder,
  createSkillProposeTool,
  defaultSkillProposalSettings,
  findSecretLikeContent,
  readSkillProposalSettings,
  validateSkillProposalDraft,
  writeSkillProposalSettings
} from '../dist/skill-proposals/index.js';
import { filterToolsForSession } from '../dist/turn/resolve-turn-tools.js';
import { PromptBuilder } from '../dist/model/prompt-builder.js';
import { resolveSkillLoad } from '../dist/runtime/skill-load.js';
import { builtinSkills, loadStateDirSkills } from '../dist/skills/builtin-skills.js';

function kvStore() {
  const map = new Map();
  return {
    getDaemonControl: (key) => map.get(key),
    setDaemonControl: (key, value) => map.set(key, value),
    getSession: () => undefined
  };
}

function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

const GOOD = {
  name: 'deploy-staging',
  description: 'Deploy the app to staging and smoke-check it',
  body: '# Deploy staging\n\n1. Run the deploy script.\n2. Hit /healthz.\n'
};

function ctx(sessionId = 'sess_1') {
  return { session: { id: sessionId, metadata: {} }, agent: { id: 'general' } };
}

function makeTool(settings, stateDir, skills = []) {
  return createSkillProposeTool({
    settingsStore: settings,
    getStateDir: () => stateDir,
    listSkills: async () => skills
  });
}

function enabledSettings() {
  const s = kvStore();
  writeSkillProposalSettings(s, { enabled: true });
  return s;
}

test('settings default to off / no reminders and persist via KV', () => {
  const s = kvStore();
  const d = readSkillProposalSettings(s);
  assert.equal(d.enabled, false);
  assert.equal(d.remindEveryNToolCalls, 0);
  assert.equal(defaultSkillProposalSettings().enabled, false);
  writeSkillProposalSettings(s, { enabled: true, remindEveryNToolCalls: 7 });
  assert.deepEqual(
    [readSkillProposalSettings(s).enabled, readSkillProposalSettings(s).remindEveryNToolCalls],
    [true, 7]
  );
  writeSkillProposalSettings(s, { remindEveryNToolCalls: 5000 });
  assert.equal(readSkillProposalSettings(s).remindEveryNToolCalls, 7, 'out-of-range value is ignored');
});

test('validation: name pattern, path traversal, size limits, frontmatter', () => {
  for (const bad of ['../evil', 'a/b', 'Upper', 'has space', '-lead', 'trail-', 'double--hyphen', '', 'x'.repeat(65), '..', '.hidden']) {
    assert.throws(() => validateSkillProposalDraft({ ...GOOD, name: bad }), /name must be/, `name ${JSON.stringify(bad)}`);
  }
  assert.doesNotThrow(() => validateSkillProposalDraft(GOOD));
  assert.throws(
    () => validateSkillProposalDraft({ ...GOOD, body: 'x'.repeat(SKILL_PROPOSAL_BODY_MAX + 1) }),
    /body exceeds/
  );
  assert.throws(() => validateSkillProposalDraft({ ...GOOD, description: 'd'.repeat(301) }), /description exceeds/);
  assert.throws(() => validateSkillProposalDraft({ ...GOOD, body: '---\nname: x\n---\nhi' }), /frontmatter/);
  assert.throws(() => validateSkillProposalDraft({ ...GOOD, body: '  ' }), /body is required/);
});

test('validation: secret-looking content is rejected', () => {
  const secrets = [
    'key is sk-abcdefghijklmnopqrstuvwxyz123456',
    'token ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'AKIAABCDEFGHIJKLMNOP',
    '-----BEGIN RSA PRIVATE KEY-----\nabc',
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789',
    'API_KEY=abcd1234efgh5678ijkl',
    'password: "hunter2hunter2hunter2"',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop'
  ];
  for (const text of secrets) {
    assert.ok(findSecretLikeContent(text), text);
    assert.throws(() => validateSkillProposalDraft({ ...GOOD, body: `${GOOD.body}\n${text}` }), /secret/);
  }
  assert.throws(() => validateSkillProposalDraft({ ...GOOD, description: 'use sk-abcdefghijklmnopqrstuvwx' }), /secret/);
  assert.equal(findSecretLikeContent('Set API_KEY to your key from the dashboard.'), undefined);
  assert.equal(findSecretLikeContent('export TOKEN=$MY_TOKEN'), undefined);
});

test('skill_propose is hidden unless the switch is on (and refuses when called while off)', async () => {
  const stateDir = tmp('sp-tool-vis');
  const off = kvStore();
  const tool = makeTool(off, stateDir);
  const other = { name: 'load_skill', description: '', inputSchema: {}, approvalMode: 'never', sideEffectLevel: 'none', execute: async () => ({ ok: true, content: '' }) };
  const agent = { id: 'general' };
  const session = { id: 's1', metadata: {} };
  const names = (settings) =>
    filterToolsForSession({ env: {}, tools: [other, tool], agent, session, settingsStore: settings }).tools.map((t) => t.name);
  assert.deepEqual(names(off), ['load_skill']);
  const on = enabledSettings();
  assert.deepEqual(names(on), ['load_skill', 'skill_propose']);
  writeSkillProposalSettings(on, { enabled: false });
  assert.deepEqual(names(on), ['load_skill'], 'switch off takes effect immediately');

  const res = await tool.execute(ctx(), GOOD);
  assert.equal(res.ok, false);
  assert.match(res.content, /disabled/);
  assert.equal(existsSync(join(stateDir, 'skill-proposals')), false, 'nothing written while disabled');
});

test('skill_propose queues a proposal and never touches skills dirs', async () => {
  const stateDir = tmp('sp-tool-queue');
  const tool = makeTool(enabledSettings(), stateDir);
  const res = await tool.execute(ctx('sess_abc'), GOOD);
  assert.equal(res.ok, true, res.content);
  const out = JSON.parse(res.content);
  assert.equal(out.status, 'pending');
  assert.equal(out.kind, 'new');
  const store = new SkillProposalStore(stateDir);
  const [rec] = store.list();
  assert.equal(rec.sessionId, 'sess_abc');
  assert.equal(rec.agentId, 'general');
  assert.equal(rec.status, 'pending');
  assert.equal(existsSync(join(stateDir, 'skills')), false, 'not installed before approval');
  assert.deepEqual((await loadStateDirSkills(stateDir)).length, 0);

  for (const bad of [{ ...GOOD, name: '../../etc/passwd' }, { ...GOOD, body: `x sk-abcdefghijklmnopqrstuvwxyz123` }]) {
    const r = await tool.execute(ctx(), bad);
    assert.equal(r.ok, false);
  }
  assert.equal(store.list().length, 1);
});

test('same-name proposals: update kind for existing skills, builtin blocked, cross-session duplicate blocked', async () => {
  const stateDir = tmp('sp-dup');
  const existing = [
    { id: 'deploy-staging', name: 'deploy-staging', description: 'x', content: 'old', source: 'workspace' },
    { id: 'Long-running harness', name: 'Long-running harness', description: 'x', content: 'b', source: 'builtin' }
  ];
  const tool = makeTool(enabledSettings(), stateDir, existing);
  const upd = JSON.parse((await tool.execute(ctx('s1'), GOOD)).content);
  assert.equal(upd.kind, 'update');
  const rec = new SkillProposalStore(stateDir).get(upd.proposalId);
  assert.deepEqual(rec.replaces, { name: 'deploy-staging', source: 'workspace' });

  const again = await tool.execute(ctx('s1'), { ...GOOD, body: `${GOOD.body}\nmore` });
  assert.equal(again.ok, true);
  assert.equal(new SkillProposalStore(stateDir).list({ status: 'pending' }).length, 1, 'same session supersedes its pending proposal');

  const cross = await tool.execute(ctx('s2'), GOOD);
  assert.equal(cross.ok, false);
  assert.match(cross.content, /another session/);

  const builtin = await tool.execute(ctx(), { ...GOOD, name: 'long-running-harness' });
  assert.equal(builtin.ok, true, 'slug differs from the builtin literal name, so it is a new skill');
  const b2 = await makeTool(enabledSettings(), tmp('sp-dup2'), [
    { id: 'harness', name: 'harness', description: 'x', content: 'b', source: 'builtin' }
  ]).execute(ctx(), { ...GOOD, name: 'harness' });
  assert.equal(b2.ok, false);
  assert.match(b2.content, /built-in/);
});

test('queue is capped', async () => {
  const stateDir = tmp('sp-cap');
  const store = new SkillProposalStore(stateDir);
  for (let i = 0; i < SKILL_PROPOSAL_MAX_PENDING; i += 1) {
    store.create({ ...GOOD, name: `skill-${i}`, sessionId: 's' });
  }
  assert.throws(() => store.create({ ...GOOD, name: 'one-more', sessionId: 's' }), /queue is full/);
});

test('approve installs under stateDir/skills, load_skill works; reject keeps record and stays unloadable', async () => {
  const prevOff = process.env.RAW_AGENT_AGENTS_SKILLS;
  process.env.RAW_AGENT_AGENTS_SKILLS = '0';
  try {
    const stateDir = tmp('sp-approve');
    const repoRoot = tmp('sp-repo');
    const repoSkillsBefore = existsSync(join(repoRoot, 'skills'));
    const settings = kvStore();
    const promptBuilder = new PromptBuilder({ store: settings, repoRoot, stateDir });
    const loader = { promptBuilder, emitTrace: () => {} };
    const store = new SkillProposalStore(stateDir);

    const a = store.create({ ...GOOD, sessionId: 's1' });
    const b = store.create({ ...GOOD, name: 'rejected-skill', sessionId: 's1' });

    const before = await resolveSkillLoad(loader, 'deploy-staging', 's1');
    assert.ok(before.error, 'not loadable before approval');

    store.reject(b.id, 'not reusable');
    promptBuilder.invalidateSkillsCache();
    assert.ok((await resolveSkillLoad(loader, 'rejected-skill', 's1')).error);
    const rejected = store.get(b.id);
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.rejectReason, 'not reusable');
    assert.equal(existsSync(join(stateDir, 'skills', 'rejected-skill')), false);

    const approved = store.approve(a.id);
    assert.equal(approved.status, 'approved');
    assert.equal(approved.installedPath, join('skills', 'deploy-staging', 'SKILL.md'));
    const file = join(stateDir, 'skills', 'deploy-staging', 'SKILL.md');
    assert.ok(readFileSync(file, 'utf8').startsWith('---\nname: deploy-staging\n'));
    promptBuilder.invalidateSkillsCache();
    const loaded = await resolveSkillLoad(loader, 'deploy-staging', 's1');
    assert.equal(loaded.error, undefined);
    assert.match(loaded.content, /Run the deploy script/);
    const all = await promptBuilder.allSkills();
    assert.equal(all.find((s) => s.name === 'deploy-staging')?.source, 'user');

    assert.equal(existsSync(join(repoRoot, 'skills')), repoSkillsBefore, 'repo skills/ untouched');
    assert.throws(() => store.approve(a.id), /already approved/);
    assert.throws(() => store.reject(a.id), /already approved/);
    assert.equal(store.list().length, 2);
  } finally {
    if (prevOff === undefined) delete process.env.RAW_AGENT_AGENTS_SKILLS;
    else process.env.RAW_AGENT_AGENTS_SKILLS = prevOff;
  }
});

test('approve re-validates stored records: tampered traversal name / secret body are refused', () => {
  const stateDir = tmp('sp-tamper');
  const store = new SkillProposalStore(stateDir);
  const rec = store.create({ ...GOOD, sessionId: 's1' });
  const file = join(stateDir, 'skill-proposals', `${rec.id}.json`);
  const original = JSON.parse(readFileSync(file, 'utf8'));

  writeFileSync(file, JSON.stringify({ ...original, name: '../../escaped' }));
  assert.throws(() => store.approve(rec.id), /invalid name/);
  writeFileSync(file, JSON.stringify({ ...original, name: 'a/../../b' }));
  assert.throws(() => store.approve(rec.id), /invalid name/);
  writeFileSync(file, JSON.stringify({ ...original, body: 'leak sk-abcdefghijklmnopqrstuvwxyz123456' }));
  assert.throws(() => store.approve(rec.id), /secret/);
  assert.equal(existsSync(join(stateDir, 'skills')), false);
  assert.equal(existsSync(join(stateDir, '..', 'escaped')), false);

  assert.equal(store.get('../../etc/passwd'), undefined);
  assert.equal(store.get('sp_nothex'), undefined);
  assert.throws(() => store.approve('../evil'), /not found/);
});

test('merge priority: workspace < user(stateDir) < ~/.agents; update proposal overrides repo skill', async () => {
  const stateDir = tmp('sp-prio');
  const repoRoot = tmp('sp-prio-repo');
  const agentsDir = tmp('sp-prio-agents');
  const mk = (root, dir, name, body) => {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, 'SKILL.md'), `---\nname: ${name}\ndescription: d\n---\n${body}\n`);
  };
  mk(repoRoot, 'skills/deploy-staging', 'deploy-staging', 'REPO body');
  mk(repoRoot, 'skills/only-repo', 'only-repo', 'REPO only');
  mk(agentsDir, 'shared', 'shared-skill', 'AGENTS body');
  mk(repoRoot, 'skills/shared-skill', 'shared-skill', 'REPO shared');

  const prevDir = process.env.RAW_AGENT_AGENTS_SKILLS_DIR;
  const prevOff = process.env.RAW_AGENT_AGENTS_SKILLS;
  process.env.RAW_AGENT_AGENTS_SKILLS_DIR = agentsDir;
  delete process.env.RAW_AGENT_AGENTS_SKILLS;
  try {
    const store = new SkillProposalStore(stateDir);
    store.approve(store.create({ ...GOOD, sessionId: 's', replaces: { name: 'deploy-staging', source: 'workspace' } }).id);
    store.approve(store.create({ ...GOOD, name: 'shared-skill', body: 'USER shared body', sessionId: 's' }).id);
    const pb = new PromptBuilder({ store: kvStore(), repoRoot, stateDir });
    const all = await pb.allSkills();
    const byName = (n) => all.find((s) => s.name === n);
    assert.match(byName('deploy-staging').content, /Run the deploy script/, 'user layer overrides workspace');
    assert.equal(byName('deploy-staging').source, 'user');
    assert.match(byName('only-repo').content, /REPO only/);
    assert.match(byName('shared-skill').content, /AGENTS body/, '~/.agents still wins over user layer');
    assert.ok(builtinSkills.length > 0);
  } finally {
    if (prevDir === undefined) delete process.env.RAW_AGENT_AGENTS_SKILLS_DIR;
    else process.env.RAW_AGENT_AGENTS_SKILLS_DIR = prevDir;
    if (prevOff !== undefined) process.env.RAW_AGENT_AGENTS_SKILLS = prevOff;
  }
});

test('approved description with quotes / brackets / colons round-trips through the skill loader', async () => {
  const stateDir = tmp('sp-desc');
  const store = new SkillProposalStore(stateDir);
  const rec = store.create({
    name: 'odd-desc',
    description: '[note] use "quotes": and colons',
    body: 'Body text here.',
    sessionId: 's'
  });
  store.approve(rec.id);
  const [skill] = await loadStateDirSkills(stateDir);
  assert.equal(skill.name, 'odd-desc');
  assert.equal(skill.description, "[note] use 'quotes': and colons");
  assert.equal(skill.content, 'Body text here.');
  assert.equal(readdirSync(join(stateDir, 'skills')).length, 1);
});

test('reminder: every N iterations on the user side, off by default', () => {
  const s = kvStore();
  const base = { settingsStore: s, agent: { id: 'general' }, session: { metadata: {} } };
  assert.equal(buildSkillProposeReminder({ ...base, turn: 4 }), '');
  writeSkillProposalSettings(s, { enabled: true });
  assert.equal(buildSkillProposeReminder({ ...base, turn: 4 }), '', 'N=0 never reminds');
  writeSkillProposalSettings(s, { remindEveryNToolCalls: 4 });
  assert.equal(buildSkillProposeReminder({ ...base, turn: 0 }), '');
  assert.equal(buildSkillProposeReminder({ ...base, turn: 3 }), '');
  assert.match(buildSkillProposeReminder({ ...base, turn: 4 }), /skill_propose/);
  assert.match(buildSkillProposeReminder({ ...base, turn: 8 }), /8 tool iterations/);
  assert.equal(
    buildSkillProposeReminder({ ...base, turn: 4, agent: { id: 'x', allowedTools: ['bash'] } }),
    '',
    'no reminder when the agent cannot call the tool'
  );
  writeSkillProposalSettings(s, { enabled: false });
  assert.equal(buildSkillProposeReminder({ ...base, turn: 4 }), '');
});
