import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStateStore } from '../dist/storage.js';
import { HeuristicModelAdapter, OpenAICompatibleAdapter } from '../dist/model/model-adapters.js';
import { parseRemoteModelList, listRemoteModels } from '../dist/model/list-models.js';
import {
  ENV_FALLBACK_PROVIDER_ID,
  HEURISTIC_PROVIDER_ID,
  MODEL_PROVIDERS_KEY,
  createAdapterFromProvider,
  deleteProvider,
  envFallbackProvider,
  hasPersistedModelCatalog,
  heuristicRef,
  maskApiKey,
  mergeModelRefMetadata,
  mergeScannedModels,
  parseModelRef,
  pickerOptions,
  publicCatalogPayload,
  publicProvider,
  readModelCatalog,
  resolveDefaultModelRef,
  resolveSessionModelAdapter,
  setCatalogDefaultRef,
  upsertProvider,
  writeModelCatalog
} from '../dist/model/provider-catalog.js';

function tmpStore() {
  const dir = mkdtempSync(join(tmpdir(), 'model-prov-'));
  const store = new SqliteStateStore(join(dir, 'state.db'));
  return { dir, store };
}

test('parseRemoteModelList accepts OpenAI and Anthropic shapes', () => {
  const openai = parseRemoteModelList({
    data: [
      { id: 'gpt-4o', owned_by: 'openai' },
      { id: 'gpt-4o' },
      { id: '' }
    ]
  });
  assert.deepEqual(
    openai.map((m) => m.id),
    ['gpt-4o']
  );
  const anthropic = parseRemoteModelList({
    data: [{ id: 'claude-sonnet-4-5', display_name: 'Sonnet' }]
  });
  assert.equal(anthropic[0]?.ownedBy, 'Sonnet');
  const strings = parseRemoteModelList({ models: ['a', 'b'] });
  assert.deepEqual(
    strings.map((m) => m.id),
    ['a', 'b']
  );
});

test('listRemoteModels uses GET /models and Bearer auth', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), auth: init.headers.authorization });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ id: 'deepseek-chat', owned_by: 'deepseek' }] })
    };
  };
  const listed = await listRemoteModels({
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-test',
    fetchImpl
  });
  assert.equal(listed.models[0]?.id, 'deepseek-chat');
  assert.equal(calls[0]?.url, 'https://api.deepseek.com/v1/models');
  assert.equal(calls[0]?.auth, 'Bearer sk-test');
});

test('catalog CRUD + picker + masked key stay in daemon_control KV', () => {
  const { dir, store } = tmpStore();
  assert.equal(hasPersistedModelCatalog(store), false);
  const p = upsertProvider(store, {
    name: 'DeepSeek',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-super-secret-key',
    models: [{ id: 'deepseek-chat', enabled: true }]
  });
  assert.equal(hasPersistedModelCatalog(store), true);
  assert.equal(readModelCatalog(store).providers[0]?.apiKey, 'sk-super-secret-key');
  const pub = publicProvider(p, 'ui');
  assert.equal(pub.hasApiKey, true);
  assert.equal(JSON.stringify(pub).includes('super-secret'), false);
  assert.match(maskApiKey('sk-super-secret-key'), /…/);
  const payload = publicCatalogPayload(store, {});
  assert.ok(payload.options.some((o) => o.modelId === 'deepseek-chat'));
  assert.ok(payload.options.some((o) => o.providerId === HEURISTIC_PROVIDER_ID));
  assert.ok(payload.catalog.providers.find((x) => x.id === p.id)?.apiKeyMasked.includes('sk-'));
  assert.equal(
    Object.prototype.hasOwnProperty.call(payload.catalog.providers.find((x) => x.id === p.id) ?? {}, 'apiKey'),
    false
  );
  setCatalogDefaultRef(store, { providerId: p.id, modelId: 'deepseek-chat' });
  assert.deepEqual(resolveDefaultModelRef(store, {}), { providerId: p.id, modelId: 'deepseek-chat' });
  assert.equal(deleteProvider(store, p.id), true);
  assert.equal(readModelCatalog(store).providers.length, 0);
  store.db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('mergeScannedModels keeps enabled flags and appends leftovers', () => {
  const merged = mergeScannedModels(
    [
      { id: 'keep-off', enabled: false },
      { id: 'gone', enabled: true }
    ],
    [{ id: 'keep-off' }, { id: 'new-one', ownedBy: 'x' }]
  );
  assert.equal(merged.find((m) => m.id === 'keep-off')?.enabled, false);
  assert.equal(merged.find((m) => m.id === 'new-one')?.enabled, true);
  assert.ok(merged.some((m) => m.id === 'gone'));
});

test('resolveSessionModelAdapter uses session modelRef over env fallback', () => {
  const { dir, store } = tmpStore();
  const p = upsertProvider(store, {
    name: 'Local',
    kind: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:8080/v1',
    apiKey: 'k',
    models: [{ id: 'my-model', enabled: true }]
  });
  const session = {
    id: 's1',
    title: 't',
    mode: 'chat',
    status: 'idle',
    agentId: 'general',
    background: false,
    todo: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: { modelRef: { providerId: p.id, modelId: 'my-model' } }
  };
  const adapter = resolveSessionModelAdapter(store, session, {
    RAW_AGENT_MODEL_PROVIDER: 'heuristic'
  }, new HeuristicModelAdapter());
  assert.equal(adapter.name, 'openai-compatible');
  assert.ok(adapter instanceof OpenAICompatibleAdapter);
  const heuristic = resolveSessionModelAdapter(
    store,
    { ...session, metadata: { modelRef: heuristicRef() } },
    {},
    new HeuristicModelAdapter()
  );
  assert.ok(heuristic instanceof HeuristicModelAdapter);
  store.db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('mergeModelRefMetadata stamps default when body omits modelRef', () => {
  const { dir, store } = tmpStore();
  writeModelCatalog(store, {
    providers: [],
    defaultRef: null,
    updatedAt: new Date().toISOString()
  });
  const meta = mergeModelRefMetadata(store, {}, {}, {});
  assert.deepEqual(meta.modelRef, heuristicRef());
  const explicit = mergeModelRefMetadata(
    store,
    {},
    { providerId: 'p1', modelId: 'm1' },
    {}
  );
  assert.deepEqual(explicit.modelRef, { providerId: 'p1', modelId: 'm1' });
  assert.equal(parseModelRef({ providerId: 'a', modelId: 'b' })?.modelId, 'b');
  store.db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('env fallback provider is listed but keys stay masked', () => {
  const env = {
    RAW_AGENT_MODEL_PROVIDER: 'openai-compatible',
    RAW_AGENT_BASE_URL: 'https://api.openai.com/v1',
    RAW_AGENT_API_KEY: 'sk-env-secret',
    RAW_AGENT_MODEL_NAME: 'gpt-4o-mini'
  };
  const p = envFallbackProvider(env);
  assert.equal(p?.id, ENV_FALLBACK_PROVIDER_ID);
  const { dir, store } = tmpStore();
  const payload = publicCatalogPayload(store, env);
  const shown = payload.catalog.providers.find((x) => x.id === ENV_FALLBACK_PROVIDER_ID);
  assert.equal(shown?.hasApiKey, true);
  assert.equal(JSON.stringify(shown).includes('sk-env-secret'), false);
  assert.ok(pickerOptions(readModelCatalog(store), env).some((o) => o.source === 'env'));
  const adapter = createAdapterFromProvider(p, 'gpt-4o-mini');
  assert.equal(adapter.name, 'openai-compatible');
  store.db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('KV key is model_providers', () => {
  assert.equal(MODEL_PROVIDERS_KEY, 'model_providers');
});
