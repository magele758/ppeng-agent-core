/**
 * kernel-lock: subpath barrels + fold/WAL characterization.
 * Phase 0/1 — layering must keep these imports and invariants.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteStateStore } from '../dist/storage.js';
import { foldCanonicalJson, foldSurface } from '../dist/session/index.js';
import { createAgentLoop } from '../dist/loop.js';
import { prepareTurnInput } from '../dist/turn/index.js';
import { foldSurface as foldFromTypes } from '../dist/exports/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const coreRoot = join(here, '..');

test('kernel-lock: @ppeng/agent-core subpath exports resolve', async () => {
  const pkg = JSON.parse(readFileSync(join(coreRoot, 'package.json'), 'utf8'));
  for (const sub of ['./types', './session', './turn', './loop']) {
    assert.ok(pkg.exports[sub], `missing exports[${sub}]`);
    assert.ok(pkg.exports[sub].default);
  }
  const [types, session, turn, loop] = await Promise.all([
    import('@ppeng/agent-core/types'),
    import('@ppeng/agent-core/session'),
    import('@ppeng/agent-core/turn'),
    import('@ppeng/agent-core/loop')
  ]);
  assert.equal(typeof types.foldSurface, 'function');
  assert.equal(typeof session.foldSurface, 'function');
  assert.equal(typeof turn.prepareTurnInput, 'function');
  assert.equal(typeof loop.createAgentLoop, 'function');
});

test('kernel-lock: session subpath fold + types subpath foldSurface are the same function', () => {
  assert.equal(foldSurface, foldFromTypes);
});

test('kernel-lock: replace keeps WAL originals; fold hides them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'layer-wal-'));
  const store = new SqliteStateStore(join(dir, 'runtime.sqlite'));
  store.upsertAgent({
    id: 'general',
    name: 'General',
    role: 'assistant',
    instructions: 'x',
    capabilities: []
  });
  const session = store.createSession({ title: 'wal', mode: 'chat', agentId: 'general' });
  const u = store.appendMessage(session.id, 'user', [{ type: 'text', text: 'old-user' }]);
  const a = store.appendMessage(session.id, 'assistant', [{ type: 'text', text: 'old-asst' }]);
  store.appendReplacement(session.id, {
    startSeq: u.seq,
    endSeq: a.seq,
    role: 'system',
    parts: [{ type: 'text', text: 'summary-of-old' }],
    key: 'compact-summary'
  });
  const wal = store.listMessages(session.id);
  const folded = store.foldMessages(session.id);
  assert.equal(wal.length, 3);
  assert.ok(wal.some((m) => m.parts[0].text === 'old-user'));
  assert.equal(folded.length, 1);
  assert.equal(folded[0].parts[0].text, 'summary-of-old');
  assert.equal(foldCanonicalJson(folded), foldCanonicalJson(foldSurface(store.listSurfaceNodes(session.id))));
  const duck = ['getSession', 'appendMessage', 'appendReplacement', 'hideByKey', 'hideRange', 'foldMessages', 'listSurfaceNodes', 'enqueueSteer', 'claimInbox'];
  for (const method of duck) {
    assert.equal(typeof store[method], 'function', `SessionSurfaceStore.${method}`);
  }
  store.db.close();
});

test('kernel-lock: turn barrel exports prepareTurnInput; loop barrel exports createAgentLoop', () => {
  assert.equal(typeof prepareTurnInput, 'function');
  assert.equal(typeof createAgentLoop, 'function');
});

test('kernel-lock: listMessages().slice leftover sites are non-model-path only', () => {
  const kernel = readFileSync(join(coreRoot, 'src/turn/kernel.ts'), 'utf8');
  const runtime = readFileSync(join(coreRoot, 'src/runtime.ts'), 'utf8');
  const hits = [];
  for (const [label, text] of [['kernel', kernel], ['runtime', runtime]]) {
    const re = /listMessages\([^)]*\)\.slice/g;
    let m;
    while ((m = re.exec(text))) {
      hits.push(`${label}:${m[0]}`);
    }
  }
  assert.deepEqual(
    hits.sort(),
    ['kernel:listMessages(sid).slice', 'kernel:listMessages(session.id).slice', 'runtime:listMessages(sessionId).slice'].sort(),
    'model packing must not use listMessages().slice; only goal/last-assistant/evolving remain'
  );
  assert.equal(
    /foldMessages\([^)]*\)\.slice/.test(kernel),
    false,
    'do not silently switch leftover slices without a dedicated PR'
  );
});

test('kernel-lock: main entry whitelist omits SqliteStateStore / SessionStore / stores impls', async () => {
  const indexSrc = readFileSync(join(coreRoot, 'src/index.ts'), 'utf8');
  const publicSrc = readFileSync(join(coreRoot, 'src/exports/public.ts'), 'utf8');
  assert.equal(/export \* from '\.\/stores\//.test(indexSrc), false);
  assert.equal(/export \* from '\.\.\/stores\//.test(publicSrc), false);
  assert.equal(/from '\.\.\/storage\.js'/.test(publicSrc), false);

  const core = await import('../dist/index.js');
  const forbidden = [
    'SqliteStateStore',
    'SessionStore',
    'TaskStore',
    'MailStore',
    'ApprovalStore',
    'SelfHealStore',
    'BackgroundJobStore',
    'MiscStore',
    'ImageAssetStore',
    'SessionMemoryStore',
    'MacOSSandboxProvider',
    'LinuxBwrapProvider',
    'DirectProvider',
    'NativeAgentSandbox',
    'RemoteVmAgentSandbox',
    'MicroserviceAgentSandbox',
    'RedisEventBufferRepository',
    'PgSkillRegistryClient',
    'TieredAssetStorage'
  ];
  for (const name of forbidden) {
    assert.equal(name in core, false, `main entry must not export ${name}`);
  }
  assert.equal(typeof core.createAgentLoop, 'function');
  assert.equal(typeof core.RawAgentRuntime, 'function');
  assert.equal(typeof core.ValidationError, 'function');
  assert.equal(typeof core.AgentMemoryStore, 'function');
  assert.equal(typeof core.createModelAdapterFromEnv, 'function');
});

test('kernel-lock: @ppeng/agent-core/loop d.ts does not mention SqliteStateStore', () => {
  const loopDts = readFileSync(join(coreRoot, 'dist/loop.d.ts'), 'utf8');
  const uncommented = loopDts.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.equal(
    uncommented.includes('SqliteStateStore'),
    false,
    'loop subpath must not leak SqliteStateStore in types'
  );
});
