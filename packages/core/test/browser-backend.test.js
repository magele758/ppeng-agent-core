import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatBrowserError,
  playwrightBrowserAction,
  setPlaywrightLoaderForTests
} from '../dist/tools/browser-backend.js';

const ctx = {
  repoRoot: '/',
  stateDir: '/',
  session: {
    id: 's-browser',
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
};

after(() => {
  setPlaywrightLoaderForTests(undefined);
});

describe('browser backend error shape', () => {
  it('formatBrowserError is structured JSON', () => {
    const raw = formatBrowserError('browser_not_installed', 'missing', { kind: 'snapshot' });
    const body = JSON.parse(raw);
    assert.equal(body.error, 'browser_not_installed');
    assert.equal(body.message, 'missing');
    assert.ok(body.installHint.includes('playwright install'));
    assert.deepEqual(body.action, { kind: 'snapshot' });
  });

  it('returns structured failure when playwright is missing — never fake success', async () => {
    setPlaywrightLoaderForTests(async () => null);
    const r = await playwrightBrowserAction(ctx, { kind: 'snapshot' });
    assert.equal(r.ok, false);
    const body = JSON.parse(r.content);
    assert.equal(body.error, 'browser_not_installed');
    assert.ok(body.installHint);
    assert.equal(body.action.kind, 'snapshot');
  });

  it('maps launch failure', async () => {
    setPlaywrightLoaderForTests(async () => ({
      chromium: {
        launch: async () => {
          throw new Error("Executable doesn't exist");
        }
      }
    }));
    const r = await playwrightBrowserAction(ctx, { kind: 'navigate', url: 'https://example.com' });
    assert.equal(r.ok, false);
    const body = JSON.parse(r.content);
    assert.equal(body.error, 'browser_launch_failed');
    assert.equal(body.action.kind, 'navigate');
  });
});
