import test from 'node:test';
import assert from 'node:assert/strict';
import { edgesFromTasks, evaluateTeamPlanDag, graphFromTasks, validateTeamPlanDag } from '../dist/teams/dag.js';

test('DAG 合法图', () => {
  const tasks = [
    { id: 'a', dependsOn: [] },
    { id: 'b', dependsOn: ['a'] },
    { id: 'c', dependsOn: ['a'] }
  ];
  const r = evaluateTeamPlanDag(tasks);
  assert.equal(r.ok, true);
  const g = graphFromTasks(tasks);
  assert.deepEqual(g.getReadyTasks(new Set()).sort(), ['a']);
  assert.deepEqual(g.getReadyTasks(new Set(['a'])).sort(), ['b', 'c']);
});

test('DAG 环检测', () => {
  const issues = validateTeamPlanDag([
    { id: 'a', dependsOn: ['b'] },
    { id: 'b', dependsOn: ['a'] }
  ]);
  assert.ok(issues.some((i) => i.kind === 'cycle'));
  const evaled = evaluateTeamPlanDag([
    { id: 'a', dependsOn: ['b'] },
    { id: 'b', dependsOn: ['a'] }
  ]);
  assert.equal(evaled.ok, false);
  assert.match(evaled.detail, /环/);
});

test('edgesFromTasks 从 dependsOn 推导边', () => {
  const edges = edgesFromTasks([
    { id: 'a', dependsOn: [] },
    { id: 'b', dependsOn: ['a'] }
  ]);
  assert.deepEqual(edges, [{ from: 'a', to: 'b' }]);
});

test('DAG 悬空边 / 自依赖 / 空图', () => {
  assert.ok(validateTeamPlanDag([]).some((i) => i.kind === 'empty'));
  assert.ok(
    validateTeamPlanDag([
      { id: 'a', dependsOn: ['missing'] }
    ]).some((i) => i.kind === 'dangling')
  );
  assert.ok(validateTeamPlanDag([{ id: 'a', dependsOn: ['a'] }]).some((i) => i.kind === 'self_dep'));
});
