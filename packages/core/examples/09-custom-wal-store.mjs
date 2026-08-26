/**
 * Phase 4 example: L1 WAL + fold only (no daemon, no AgentLoop).
 *
 * Append your own rows, then pack with `foldMessages` / `foldSurface`.
 * Uses `createMemorySurfaceStore` from `@ppeng/agent-core/session`.
 *
 *   node packages/core/examples/09-custom-wal-store.mjs
 */
import { createMemorySurfaceStore, foldSurface } from '@ppeng/agent-core/session';

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const store = createMemorySurfaceStore();
const session = store.createSession({
  title: 'l1-fold-only',
  mode: 'chat',
  agentId: 'general'
});

store.appendMessage(session.id, 'user', [{ type: 'text', text: 'hello' }]);
store.appendMessage(session.id, 'assistant', [{ type: 'text', text: 'hi' }]);
store.appendMessage(session.id, 'user', [{ type: 'text', text: 'note-v1' }], { key: 'note' });
store.hideByKey(session.id, 'note');
store.appendMessage(session.id, 'user', [{ type: 'text', text: 'note-v2' }], { key: 'note' });

const wal = store.listSurfaceNodes(session.id);
const folded = store.foldMessages(session.id);
const foldedAgain = foldSurface(store.listSurfaceNodes(session.id));

const foldTexts = folded
  .flatMap((m) => m.parts.filter((p) => p.type === 'text').map((p) => p.text))
  .join('|');
const walHasV1 = wal.some((n) => n.parts.some((p) => p.type === 'text' && p.text === 'note-v1'));
const foldHasV1 = folded.some((m) => m.parts.some((p) => p.type === 'text' && p.text === 'note-v1'));
const foldHasV2 = folded.some((m) => m.parts.some((p) => p.type === 'text' && p.text === 'note-v2'));

console.log('WAL nodes:', wal.length, 'fold rows:', folded.length);
console.log('fold texts:', foldTexts);

if (wal.length < 5) fail('WAL should keep originals including hidden/replaced keys');
if (!walHasV1) fail('WAL listSurfaceNodes should still contain note-v1');
if (foldHasV1) fail('fold must hide note-v1 after hideByKey');
if (!foldHasV2) fail('fold must show latest same-key append (note-v2)');
if (folded.length !== foldedAgain.length) fail('foldMessages must equal foldSurface(listSurfaceNodes)');

console.log('09-custom-wal-store: ok');
