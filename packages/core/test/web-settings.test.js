import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSearchUrlTemplate,
  defaultWebSettings,
  hasPersistedWebSettings,
  readWebSettings,
  resolveWebSearchTemplate,
  WEB_SEARCH_NOT_CONFIGURED,
  writeWebSettings
} from '../dist/tools/web-settings.js';
import { ValidationError } from '../dist/errors.js';
import { filterToolsForSession } from '../dist/turn/resolve-turn-tools.js';
import { webSearchFromEnv } from '../dist/tools/web-fetch.js';

function memoryStore(initial = {}) {
  const kv = { ...initial };
  return {
    getDaemonControl(key) {
      return kv[key];
    },
    setDaemonControl(key, value) {
      kv[key] = value;
    }
  };
}

test('unconfigured webSearchFromEnv points at Lab, not only env', async () => {
  const r = await webSearchFromEnv({}, { query: 'test' });
  assert.equal(r.ok, false);
  assert.match(r.content, /not configured/);
  assert.match(r.content, /Lab/);
  assert.equal(r.content, WEB_SEARCH_NOT_CONFIGURED);
});

test('search URL template must be absolute http(s) with {query}', () => {
  assert.doesNotThrow(() => assertSearchUrlTemplate(''));
  assert.doesNotThrow(() => assertSearchUrlTemplate('https://html.duckduckgo.com/html/?q={query}'));
  assert.throws(() => assertSearchUrlTemplate('https://example.com/search'), ValidationError);
  assert.throws(() => assertSearchUrlTemplate('/search?q={query}'), ValidationError);
});

test('persisted empty template hides web_search even if env is set', () => {
  const store = memoryStore();
  writeWebSettings(store, { searchUrl: '' });
  assert.equal(hasPersistedWebSettings(store), true);
  assert.equal(
    resolveWebSearchTemplate(store, { RAW_AGENT_WEB_SEARCH_URL: 'https://example.com/?q={query}' }),
    undefined
  );
});

test('env fallback only when Lab never saved', () => {
  const store = memoryStore();
  assert.equal(readWebSettings(store).searchUrl, defaultWebSettings().searchUrl);
  assert.equal(
    resolveWebSearchTemplate(store, { RAW_AGENT_WEB_SEARCH_URL: 'https://example.com/?q={query}' }),
    'https://example.com/?q={query}'
  );
  writeWebSettings(store, { searchUrl: 'https://searx.example/?q={query}' });
  assert.equal(resolveWebSearchTemplate(store, { RAW_AGENT_WEB_SEARCH_URL: 'https://example.com/?q={query}' }), 'https://searx.example/?q={query}');
});

test('filterToolsForSession drops web_search when no template', () => {
  const tools = [
    { name: 'web_fetch' },
    { name: 'web_search' },
    { name: 'read_file' }
  ];
  const session = { id: 's', metadata: {} };
  const agent = { id: 'general', name: 'g' };
  const hidden = filterToolsForSession({
    env: {},
    tools,
    agent,
    session,
    settingsStore: memoryStore()
  });
  assert.deepEqual(
    hidden.tools.map((t) => t.name),
    ['web_fetch', 'read_file']
  );
  const shown = filterToolsForSession({
    env: { RAW_AGENT_WEB_SEARCH_URL: 'https://example.com/?q={query}' },
    tools,
    agent,
    session,
    settingsStore: memoryStore()
  });
  assert.ok(shown.tools.some((t) => t.name === 'web_search'));
});
