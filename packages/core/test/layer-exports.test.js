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
import { createRequire } from 'node:module';
import { SqliteStateStore } from '../dist/storage.js';
import { foldCanonicalJson, foldSurface } from '../dist/session/index.js';
import { createAgentLoop } from '../dist/loop.js';
import { prepareTurnInput } from '../dist/turn/index.js';
import { foldSurface as foldFromTypes } from '../dist/exports/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const coreRoot = join(here, '..');

test('kernel-lock: @ppeng/agent-core subpath exports resolve', () => {
  const require = createRequire(join(coreRoot, 'package.json'));
  const pkg = require('../package.json');
  for (const sub of ['./types', './session', './turn', './loop']) {
    assert.ok(pkg.exports[sub], `missing exports[${sub}]`);
    assert.ok(pkg.exports[sub].default);
  }
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
