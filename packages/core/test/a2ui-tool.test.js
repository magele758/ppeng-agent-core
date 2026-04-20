import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createBuiltinTools } from '../dist/tools/builtin-tools.js';
import { AGENT_NATIVE_CATALOG_ID, BASIC_CATALOG_ID } from '../dist/a2ui/index.js';

const ENV_KEY = 'RAW_AGENT_A2UI_ENABLED';

describe('a2ui_render tool', () => {
  let prev;
  beforeEach(() => {
    prev = process.env[ENV_KEY];
    process.env[ENV_KEY] = '1';
  });
  afterEach(() => {
    if (prev === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = prev;
  });

  it('is registered when RAW_AGENT_A2UI_ENABLED=1', () => {
    const tools = createBuiltinTools(stubServices());
    const names = tools.map((t) => t.name);
    assert.ok(names.includes('a2ui_render'), `tools include a2ui_render: ${names.join(',')}`);
    assert.ok(names.includes('a2ui_delete_surface'));
  });

  it('returns metadata.a2uiMessages for downstream runtime to persist + stream', async () => {
    const tools = createBuiltinTools(stubServices());
    const tool = tools.find((t) => t.name === 'a2ui_render');
    const result = await tool.execute(stubContext(), {
      surfaceId: 'demo',
      catalogId: BASIC_CATALOG_ID,
      messages: [
        { createSurface: { surfaceId: 'demo', catalogId: BASIC_CATALOG_ID } },
        {
          updateComponents: {
            surfaceId: 'demo',
            components: [{ id: 'root', component: 'Text', text: 'hi' }]
          }
        }
      ]
    });
    assert.equal(result.ok, true, result.content);
    assert.equal(result.metadata?.a2uiSurfaceId, 'demo');
    assert.equal(result.metadata?.a2uiCatalogId, BASIC_CATALOG_ID);
    assert.equal(Array.isArray(result.metadata?.a2uiMessages), true);
    assert.equal(result.metadata.a2uiMessages.length, 2);
    // tool stamps the version
    assert.equal(result.metadata.a2uiMessages[0].version, 'v0.9');
  });

  it('accepts incremental updates without createSurface (lenient mode)', async () => {
    const tools = createBuiltinTools(stubServices());
    const tool = tools.find((t) => t.name === 'a2ui_render');
    // Spec: agent may skip createSurface when the surface already exists
    // (e.g. created by a previous a2ui_render call).
    const result = await tool.execute(stubContext(), {
      surfaceId: 'task',
      messages: [
        {
          updateDataModel: {
            surfaceId: 'task',
            value: { user: 'alice' }
          }
        }
      ]
    });
    assert.equal(result.ok, true, result.content);
    assert.equal(result.metadata.a2uiSurfaceId, 'task');
    // No createSurface in this batch → empty catalogId on the part. Renderer
    // derives the live catalogId from the cross-message accumulator instead.
    assert.equal(result.metadata.a2uiCatalogId, '');
    // surface id surfaces the warning so debugging is possible
    assert.match(result.content, /Warnings:/);
  });

  it('rejects bad envelopes with a friendly error', async () => {
    const tools = createBuiltinTools(stubServices());
    const tool = tools.find((t) => t.name === 'a2ui_render');
    const result = await tool.execute(stubContext(), {
      surfaceId: 'oops',
      catalogId: 'https://example.test/unknown',
      messages: [{ createSurface: { surfaceId: 'oops', catalogId: 'https://example.test/unknown' } }]
    });
    assert.equal(result.ok, false);
    assert.match(result.content, /unknown catalogId/);
  });

  it('rejects empty message array', async () => {
    const tools = createBuiltinTools(stubServices());
    const tool = tools.find((t) => t.name === 'a2ui_render');
    const result = await tool.execute(stubContext(), { surfaceId: 'x', messages: [] });
    assert.equal(result.ok, false);
    assert.match(result.content, /non-empty array/);
  });

  it('a2ui_delete_surface returns a deleteSurface envelope', async () => {
    const tools = createBuiltinTools(stubServices());
    const tool = tools.find((t) => t.name === 'a2ui_delete_surface');
    const result = await tool.execute(stubContext(), { surfaceId: 'gone' });
    assert.equal(result.ok, true);
    assert.equal(result.metadata.a2uiMessages[0].deleteSurface.surfaceId, 'gone');
  });
});

describe('a2ui tools (gating)', () => {
  it('are NOT registered when RAW_AGENT_A2UI_ENABLED is unset', () => {
    const prev = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
    try {
      const tools = createBuiltinTools(stubServices());
      const names = tools.map((t) => t.name);
      assert.ok(!names.includes('a2ui_render'));
      assert.ok(!names.includes('a2ui_delete_surface'));
    } finally {
      if (prev !== undefined) process.env[ENV_KEY] = prev;
    }
  });
});

// minimal stubs — a2ui tools don't touch services / context.
function stubServices() {
  return {
    loadSkill: async () => ({ content: '' }),
    updateTodo: async () => [],
    createTask: async () => ({}),
    getTask: async () => undefined,
    listTasks: async () => [],
    updateTask: async () => ({}),
    harnessWriteSpec: async () => '',
    spawnSubagent: async () => '',
    spawnTeammate: async () => '',
    listAgents: async () => [],
    sendMail: async () => ({}),
    readInbox: async () => [],
    startBackgroundJob: async () => ({}),
    getBackgroundJob: async () => undefined,
    listBackgroundJobs: async () => [],
    listWorkspaces: async () => [],
    upsertSessionMemory: async () => ({}),
    listSessionMemory: async () => [],
    deleteSessionMemory: async () => true,
    visionAnalyze: async () => ''
  };
}

function stubContext() {
  return {
    repoRoot: process.cwd(),
    stateDir: process.cwd(),
    agent: { id: 'a' },
    session: { id: 's' }
  };
}

// Ensure validator side-effect catalogs are loaded before running.
// The import above already triggered registerBasicCatalog / registerAgentNativeCatalog
// via dist/a2ui/index.js — assert here just to guard against future regressions.
assert.ok(BASIC_CATALOG_ID && AGENT_NATIVE_CATALOG_ID);
