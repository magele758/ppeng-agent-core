import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ANONYMOUS_AUTH, RawAgentRuntime } from '@ppeng/agent-core';
import { socialRoutes } from '../../apps/daemon/dist/routes/social.js';

const idleAdapter = {
  name: 'idle',
  async runTurn() {
    return { stopReason: 'end', assistantParts: [{ type: 'text', text: 'ok' }] };
  },
  async summarizeMessages() {
    return '';
  }
};

const repoRoot = mkdtempSync(join(tmpdir(), 'social-repo-'));
const runtime = new RawAgentRuntime({
  repoRoot,
  stateDir: mkdtempSync(join(tmpdir(), 'social-state-')),
  modelAdapter: idleAdapter
});
const action = socialRoutes(runtime, repoRoot).find((r) => r.pattern === '/api/social-post-schedules/:taskId/action');

async function postAction(taskId, body) {
  const out = { status: 0, body: undefined };
  const response = {
    statusCode: 200,
    setHeader() {},
    end(text) {
      out.status = this.statusCode;
      out.body = text ? JSON.parse(text) : undefined;
    }
  };
  try {
    await action.handler({
      request: { method: 'POST', headers: {} },
      response,
      url: new URL(`http://x/api/social-post-schedules/${taskId}/action`),
      parts: [],
      params: { taskId },
      requireParam: () => taskId,
      readBody: async () => body,
      auth: ANONYMOUS_AUTH
    });
  } catch (error) {
    return { status: error.statusCode ?? 500, message: error.message };
  }
  return out;
}

test('social schedule action rejects unknown actions before touching tasks', async () => {
  const res = await postAction('whatever', { action: 'noop' });
  assert.equal(res.status, 400);
  assert.match(res.message, /approve, reject, cancel, or run_now/);
});

for (const name of ['approve', 'reject', 'cancel', 'run_now']) {
  test(`social schedule action ${name} on a missing task is 404`, async () => {
    assert.equal((await postAction('no-such-task', { action: ` ${name} ` })).status, 404);
  });
}
