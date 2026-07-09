import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CronJobStore, markCronJobRan } from '../dist/cron/cron-store.js';

test('CronJobStore create list due and mark', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cron-test-'));
  const store = new CronJobStore(dir);
  const job = store.create({
    sessionId: 's1',
    agentId: 'general',
    name: 'ping',
    prompt: 'say hi',
    scheduleKind: 'every_ms',
    scheduleValue: '1',
    nextRunAt: new Date(Date.now() - 1000).toISOString(),
    metadata: {}
  });
  assert.equal(store.list({ sessionId: 's1' }).length, 1);
  const due = store.dueJobs();
  assert.ok(due.some((j) => j.id === job.id));
  const updated = markCronJobRan(store, job);
  assert.ok(updated?.lastRunAt);
  assert.ok(updated?.nextRunAt);
  assert.equal(store.remove(job.id), true);
});
