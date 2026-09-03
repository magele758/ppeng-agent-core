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

test('defaultBrowserAction is the Playwright backend', () => {
  assert.equal(typeof defaultBrowserAction, 'function');
});
