import test from 'node:test';
import assert from 'node:assert/strict';
import { RUN_STATUSES, TASK_STATUSES, countByStatus, filterByStatusAndQuery } from './task-filters.ts';

const tasks = [
  { title: 'Write report', status: 'pending', ownerAgentId: 'researcher' },
  { title: 'Fix login bug', status: 'in_progress', ownerAgentId: 'coder' },
  { title: 'Deploy site', status: 'failed', ownerAgentId: 'coder' },
  { title: 'Summarize docs', status: 'completed' },
  { title: 'Deploy docs', status: 'failed', ownerAgentId: 'ops' }
];

const taskText = (t: (typeof tasks)[number]) => [t.title, t.ownerAgentId];

test('按状态统计数量，含「全部」和零值状态 [AC:console-tasks#AC-1]', () => {
  const counts = countByStatus(tasks, TASK_STATUSES);
  assert.equal(counts.all, 5);
  assert.equal(counts.failed, 2);
  assert.equal(counts.pending, 1);
  assert.equal(counts.cancelled, 0);
});

test('状态筛选只保留所选状态，all 恢复完整列表 [AC:console-tasks#AC-1]', () => {
  const failed = filterByStatusAndQuery(tasks, { status: 'failed', query: '' }, taskText);
  assert.deepEqual(failed.map((t) => t.title), ['Deploy site', 'Deploy docs']);
  assert.equal(filterByStatusAndQuery(tasks, { status: 'all', query: '' }, taskText).length, 5);
});

test('关键词匹配标题或负责 Agent，忽略大小写，可与状态叠加 [AC:console-tasks#AC-2]', () => {
  assert.deepEqual(
    filterByStatusAndQuery(tasks, { status: 'all', query: 'CODER' }, taskText).map((t) => t.title),
    ['Fix login bug', 'Deploy site']
  );
  assert.deepEqual(
    filterByStatusAndQuery(tasks, { status: 'failed', query: 'docs' }, taskText).map((t) => t.title),
    ['Deploy docs']
  );
  assert.equal(filterByStatusAndQuery(tasks, { status: 'all', query: 'zzz' }, taskText).length, 0);
});

test('空列表统计全为零，筛选返回空 [AC:console-tasks#AC-3]', () => {
  const counts = countByStatus([], TASK_STATUSES);
  assert.equal(counts.all, 0);
  assert.ok(TASK_STATUSES.every((s) => counts[s] === 0));
  assert.deepEqual(filterByStatusAndQuery([], { status: 'all', query: '' }, taskText), []);
});

test('编排运行按状态统计与筛选 [AC:console-tasks#AC-6]', () => {
  const runs = [
    { title: 'Refactor', status: 'running', riskLevel: 'low' },
    { title: 'Migrate', status: 'blocked', riskLevel: 'high' },
    { title: 'Docs', status: 'completed' }
  ];
  const counts = countByStatus(runs, RUN_STATUSES);
  assert.equal(counts.all, 3);
  assert.equal(counts.blocked, 1);
  assert.equal(counts.waiting_approval, 0);
  const blocked = filterByStatusAndQuery(runs, { status: 'blocked', query: '' }, (r) => [r.title, r.riskLevel]);
  assert.deepEqual(blocked.map((r) => r.title), ['Migrate']);
});
