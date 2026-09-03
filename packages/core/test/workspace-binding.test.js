import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyUnboundWorkspaceBindingPatch,
  inheritWorkspaceBinding,
  parseWorkspaceBinding,
  sealWorkspaceBindingPatch,
  workspaceBindingFromMetadata,
  workspaceBindingsEqual
} from '../dist/workspace/binding.js';

test('parseWorkspaceBinding requires ids for project/cloud', () => {
  assert.deepEqual(parseWorkspaceBinding({ kind: 'default' }), { kind: 'default' });
  assert.equal(parseWorkspaceBinding({ kind: 'project' }), undefined);
  assert.deepEqual(parseWorkspaceBinding({ kind: 'project', projectId: 'proj_1' }), {
    kind: 'project',
    projectId: 'proj_1'
  });
  assert.deepEqual(parseWorkspaceBinding({ kind: 'cloud_folder', cloudFolderId: 'cfl_1' }), {
    kind: 'cloud_folder',
    cloudFolderId: 'cfl_1'
  });
  assert.equal(parseWorkspaceBinding({ kind: 'nope' }), undefined);
});

test('write-once binding matches task-mode seal', () => {
  const first = applyUnboundWorkspaceBindingPatch({}, { kind: 'project', projectId: 'p1' });
  assert.equal(first.ok, true);
  if (first.ok) {
    assert.deepEqual(first.patch, { workspaceBinding: { kind: 'project', projectId: 'p1' } });
  }
  const again = applyUnboundWorkspaceBindingPatch(
    { workspaceBinding: { kind: 'project', projectId: 'p1' } },
    { kind: 'cloud_folder', cloudFolderId: 'c1' }
  );
  assert.equal(again.ok, true);

  const sealed = sealWorkspaceBindingPatch(
    { workspaceBinding: { kind: 'project', projectId: 'p1' } },
    { kind: 'project', projectId: 'p1' }
  );
  assert.deepEqual(sealed, {
    workspaceBinding: { kind: 'project', projectId: 'p1' },
    workspaceBindingBound: true
  });

  const blocked = applyUnboundWorkspaceBindingPatch(
    { workspaceBinding: { kind: 'project', projectId: 'p1' }, workspaceBindingBound: true },
    { kind: 'default' }
  );
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.bound.kind, 'project');
  }

  const same = applyUnboundWorkspaceBindingPatch(
    { workspaceBinding: { kind: 'project', projectId: 'p1' }, workspaceBindingBound: true },
    { kind: 'project', projectId: 'p1' }
  );
  assert.equal(same.ok, true);
  if (same.ok) assert.deepEqual(same.patch, {});
});

test('default binding is never sealed and leftover bound default stays writable', () => {
  assert.deepEqual(sealWorkspaceBindingPatch({}, { kind: 'default' }), {});
  assert.deepEqual(
    sealWorkspaceBindingPatch(
      { workspaceBinding: { kind: 'default' }, workspaceBindingBound: true },
      { kind: 'default' }
    ),
    {}
  );

  const leftover = applyUnboundWorkspaceBindingPatch(
    { workspaceBinding: { kind: 'default' }, workspaceBindingBound: true },
    { kind: 'project', projectId: 'p1' }
  );
  assert.equal(leftover.ok, true);
  if (leftover.ok) {
    assert.deepEqual(leftover.patch, { workspaceBinding: { kind: 'project', projectId: 'p1' } });
  }

  const backToDefault = applyUnboundWorkspaceBindingPatch(
    { workspaceBinding: { kind: 'default' }, workspaceBindingBound: true },
    { kind: 'default' }
  );
  assert.equal(backToDefault.ok, true);
});

test('inheritWorkspaceBinding copies bound project/cloud', () => {
  assert.deepEqual(inheritWorkspaceBinding({}), {});
  assert.deepEqual(
    inheritWorkspaceBinding({
      workspaceBinding: { kind: 'project', projectId: 'p1' },
      workspaceBindingBound: true
    }),
    {
      workspaceBinding: { kind: 'project', projectId: 'p1' },
      workspaceBindingBound: true
    }
  );
});

test('workspaceBindingsEqual is kind-aware', () => {
  assert.equal(
    workspaceBindingsEqual({ kind: 'project', projectId: 'a' }, { kind: 'project', projectId: 'a' }),
    true
  );
  assert.equal(
    workspaceBindingsEqual({ kind: 'project', projectId: 'a' }, { kind: 'project', projectId: 'b' }),
    false
  );
  assert.equal(workspaceBindingFromMetadata(undefined).kind, 'default');
});
