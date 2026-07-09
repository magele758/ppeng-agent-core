import test from 'node:test';
import assert from 'node:assert/strict';
import {
  browserToolsFeatureEnabled,
  createBrowserTools,
  defaultBrowserAction
} from '../dist/tools/browser-tools.js';

test('browserToolsFeatureEnabled defaults false', () => {
  assert.equal(browserToolsFeatureEnabled({}), false);
  assert.equal(browserToolsFeatureEnabled({ RAW_AGENT_BROWSER_TOOLS: '1' }), true);
});

test('createBrowserTools exposes four tools', () => {
  const tools = createBrowserTools({
    runBrowserAction: (ctx, action) => defaultBrowserAction(ctx, action)
  });
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ['browser_click', 'browser_navigate', 'browser_snapshot', 'browser_type']
  );
});

test('defaultBrowserAction returns unavailable', async () => {
  const r = await defaultBrowserAction(
    {
      repoRoot: '/',
      stateDir: '/',
      session: {
        id: 's',
        title: 't',
        mode: 'chat',
        status: 'idle',
        agentId: 'a',
        background: false,
        todo: [],
        metadata: {},
        createdAt: '',
        updatedAt: ''
      },
      agent: { id: 'a', name: 'a', role: 'x', instructions: '', capabilities: [] }
    },
    { kind: 'snapshot' }
  );
  assert.equal(r.ok, false);
  assert.ok(String(r.content).includes('browser_backend_unavailable'));
});
