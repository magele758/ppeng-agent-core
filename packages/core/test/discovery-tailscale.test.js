import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteStateStore } from '../dist/storage.js';
import {
  CapabilityRegistry,
  parseTailscaleStatusJson,
  loadTailscaleStatusFromFile
} from '../dist/discovery/index.js';
import { createTailscaleTools } from '../dist/tools/tailscale-tools.js';
import { applyVerify, verifyTailscaleNode } from '../dist/discovery/verify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, 'fixtures/tailscale/status.json');

test('tailscale adapter: mock status → candidate cards', () => {
  const status = loadTailscaleStatusFromFile(FIXTURE);
  const cards = parseTailscaleStatusJson(status);
  assert.ok(cards.length >= 4);
  assert.ok(cards.every((c) => c.kind === 'tailscale-node'));
  assert.ok(cards.every((c) => c.trust === 'untrusted'));
  const offline = cards.find((c) => c.name === 'pi-offline');
  assert.ok(offline);
  assert.equal(offline.metadata.online, false);
  assert.equal(offline.metadata.operable, false);
  const nas = cards.find((c) => c.name === 'nas-01');
  assert.ok(nas.tags.includes('tag:server'));
});

test('tailscale tools: list/get with registry; offline not operable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ts-tools-'));
  const store = new SqliteStateStore(join(dir, 'state.db'));
  const registry = new CapabilityRegistry(store.capabilities());
  const status = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  for (const c of parseTailscaleStatusJson(status)) {
    const card = registry.create(c);
    applyVerify(registry, card.id, verifyTailscaleNode(card));
  }

  const env = {
    RAW_AGENT_DISCOVERY: '1',
    RAW_AGENT_TAILSCALE_DISCOVERY: '1'
  };
  const tools = createTailscaleTools({ getRegistry: () => registry, env });
  const list = tools.find((t) => t.name === 'tailscale_list_devices');
  const get = tools.find((t) => t.name === 'tailscale_get_device');
  const listed = await list.execute({ sessionId: 's1' }, {});
  assert.equal(listed.ok, true);
  const body = JSON.parse(listed.content);
  assert.ok(body.count >= 4);

  const offlineCard = registry.list({ kind: 'tailscale-node' }).find((c) => c.name === 'pi-offline');
  const detail = await get.execute({ sessionId: 's1' }, { id: offlineCard.id });
  const d = JSON.parse(detail.content);
  assert.equal(d.operable, false);

  // disabled flag
  const offTools = createTailscaleTools({
    getRegistry: () => registry,
    env: { RAW_AGENT_DISCOVERY: '0', RAW_AGENT_TAILSCALE_DISCOVERY: '0' }
  });
  const denied = await offTools[0].execute({ sessionId: 's1' }, {});
  assert.equal(denied.ok, false);

  store.db.close();
  rmSync(dir, { recursive: true, force: true });
});
