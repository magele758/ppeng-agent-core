import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RawAgentRuntime } from '../dist/runtime.js';
import { findToolByName } from '../dist/tools/tool-orchestration.js';
import { ValidationError } from '../dist/errors.js';

class StubAdapter {
  constructor() {
    this.name = 'stub';
  }
  async runTurn() {
    return { stopReason: 'end', assistantParts: [{ type: 'text', text: 'ok' }] };
  }
  async summarizeMessages() {
    return 'summary';
  }
}

describe('social schedule operator flow', () => {
  it('lists, approves, dispatches once, then is idempotent', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'soc-flow-repo-'));
    const stateDir = mkdtempSync(join(tmpdir(), 'soc-flow-state-'));
    const rt = new RawAgentRuntime({ repoRoot, stateDir, modelAdapter: new StubAdapter() });

    const tool = findToolByName(rt.tools, 'schedule_social_post');
    assert.ok(tool);
    const ctx = {
      repoRoot,
      stateDir,
      agent: { id: 'agent_x' },
      session: { id: 'session_y' }
    };
    const exec = await tool.execute(ctx, {
      body: 'Queue test',
      channels: ['x'],
      publish_at: '2026-04-18T12:00:00.000Z'
    });
    assert.equal(exec.ok, true);
    const { taskId } = JSON.parse(exec.content);

    const rows = rt.listSocialPostScheduleSummaries();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].taskId, taskId);
    assert.equal(rows[0].approval, 'pending_approval');

    rt.applySocialPostScheduleAction(taskId, 'approve');

    let deliverCalls = 0;
    const deliver = async () => {
      deliverCalls += 1;
      return { ok: true, detail: 'sent' };
    };

    const t1 = await rt.dispatchSocialPostScheduleNow(taskId, deliver);
    assert.equal(deliverCalls, 1);
    assert.equal(t1.status, 'completed');

    const t2 = await rt.dispatchSocialPostScheduleNow(taskId, deliver);
    assert.equal(deliverCalls, 1);
    assert.equal(t2.status, 'completed');
  });

  it('run_now before approve throws', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'soc-flow-repo-'));
    const stateDir = mkdtempSync(join(tmpdir(), 'soc-flow-state-'));
    const rt = new RawAgentRuntime({ repoRoot, stateDir, modelAdapter: new StubAdapter() });
    const tool = findToolByName(rt.tools, 'schedule_social_post');
    const exec = await tool.execute(
      { repoRoot, stateDir, agent: { id: 'a' }, session: { id: 's' } },
      {
        body: 'Hi',
        channels: ['linkedin'],
        publish_at: '2026-04-18T12:00:00.000Z',
        approval: 'draft'
      }
    );
    const { taskId } = JSON.parse(exec.content);
    await assert.rejects(
      () => rt.dispatchSocialPostScheduleNow(taskId, async () => ({ ok: true, detail: '' })),
      ValidationError
    );
  });
});
