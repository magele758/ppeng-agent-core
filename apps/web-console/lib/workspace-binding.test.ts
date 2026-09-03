import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindingFromPickerValue,
  decodeWorkspacePickerValue,
  encodeWorkspacePickerValue,
  formatRootList,
  formatUnavailableMessage,
  normalizeWorkspaceBinding,
  parseCloudFoldersResponse,
  parseCreatedCloudFolder,
  parseCreatedProject,
  childBrowsePath,
  parentDirOf,
  parseFsBrowse,
  parseFsValidate,
  parseProjectsResponse,
  canChangeWorkspaceBinding,
  parseWorkspaceBinding,
  parseWorkspaceBindingBound,
  pickerValueFromBinding,
  validateNewCloudDraft,
  validateNewProjectDraft,
  workspaceAvailabilityFrom,
  workspaceBindingBody,
  workspaceBindingLabel,
  workspaceBindingsEqual,
  workspaceSendBlockReason
} from './workspace-binding.ts';

test('parseWorkspaceBinding reads camelCase and snake_case', () => {
  assert.deepEqual(parseWorkspaceBinding(undefined), { kind: 'default' });
  assert.deepEqual(parseWorkspaceBinding({}), { kind: 'default' });
  assert.deepEqual(
    parseWorkspaceBinding({ workspaceBinding: { kind: 'project', projectId: 'p1' } }),
    { kind: 'project', projectId: 'p1' }
  );
  assert.deepEqual(
    parseWorkspaceBinding({
      workspace_binding: { kind: 'cloud_folder', cloud_folder_id: 'c1' }
    }),
    { kind: 'cloud_folder', cloudFolderId: 'c1' }
  );
  assert.equal(parseWorkspaceBindingBound({ workspaceBindingBound: true }), true);
  assert.equal(parseWorkspaceBindingBound({ workspace_binding_bound: true }), true);
  assert.equal(parseWorkspaceBindingBound({}), false);
  assert.equal(canChangeWorkspaceBinding(true, { kind: 'default' }), true);
  assert.equal(canChangeWorkspaceBinding(true, { kind: 'project', projectId: 'p1' }), false);
  assert.equal(canChangeWorkspaceBinding(true, { kind: 'cloud_folder', cloudFolderId: 'c1' }), false);
  assert.equal(canChangeWorkspaceBinding(false, { kind: 'project', projectId: 'p1' }), true);
  assert.equal(canChangeWorkspaceBinding(true), false);
});

test('normalizeWorkspaceBinding rejects unknown kinds', () => {
  assert.deepEqual(normalizeWorkspaceBinding({ kind: 'repo' }), { kind: 'default' });
  assert.deepEqual(normalizeWorkspaceBinding({ kind: 'cloudFolder', cloudFolderId: 'x' }), {
    kind: 'cloud_folder',
    cloudFolderId: 'x'
  });
});

test('workspaceBindingsEqual and body', () => {
  assert.equal(
    workspaceBindingsEqual({ kind: 'default' }, { kind: 'default', projectId: 'x' }),
    true
  );
  assert.equal(
    workspaceBindingsEqual({ kind: 'project', projectId: 'a' }, { kind: 'project', projectId: 'a' }),
    true
  );
  assert.equal(
    workspaceBindingsEqual({ kind: 'project', projectId: 'a' }, { kind: 'project', projectId: 'b' }),
    false
  );
  assert.deepEqual(workspaceBindingBody({ kind: 'default' }), {
    workspaceBinding: { kind: 'default' }
  });
  assert.deepEqual(workspaceBindingBody({ kind: 'project', projectId: 'p1' }), {
    workspaceBinding: { kind: 'project', projectId: 'p1' }
  });
  assert.deepEqual(workspaceBindingBody({ kind: 'cloud_folder', cloudFolderId: 'c1' }), {
    workspaceBinding: { kind: 'cloud_folder', cloudFolderId: 'c1' }
  });
});

test('workspaceSendBlockReason blocks unavailable roots and empty project', () => {
  assert.equal(workspaceSendBlockReason({ binding: { kind: 'default' }, roots: [] }), null);
  assert.equal(
    workspaceSendBlockReason({ binding: { kind: 'project' }, roots: [] }),
    '未选择 Project'
  );
  const reason = workspaceSendBlockReason({
    binding: { kind: 'project', projectId: 'p1' },
    roots: [{ path: '/gone', alias: 'app', ok: false, error: 'ENOENT' }]
  });
  assert.match(String(reason), /工作区根不可用：app/);
  assert.match(String(reason), /不会回退到仓库根/);
  assert.match(String(reason), /请换 Project 或改回默认/);

  const sealed = formatUnavailableMessage(
    [{ path: '/gone', alias: 'app', ok: false, error: 'ENOENT' }],
    true
  );
  assert.match(sealed, /已封印会话不能改绑定/);

  assert.match(
    String(
      workspaceSendBlockReason({
        binding: { kind: 'project', projectId: 'p1' },
        roots: [],
        checking: false
      })
    ),
    /没有可用根目录/
  );
  assert.equal(
    workspaceSendBlockReason({
      binding: { kind: 'project', projectId: 'p1' },
      roots: [],
      checking: true
    }),
    null
  );
  assert.match(
    String(
      workspaceSendBlockReason({
        binding: { kind: 'project', projectId: 'p1' },
        roots: [{ path: '/gone', ok: false }],
        checking: true
      })
    ),
    /工作区根不可用/
  );
  assert.equal(
    workspaceSendBlockReason({
      binding: { kind: 'project', projectId: 'p1' },
      roots: [{ path: '/ok', ok: true, realPath: '/ok' }]
    }),
    null
  );
});

test('workspaceAvailabilityFrom sets blocked from reason', () => {
  const open = workspaceAvailabilityFrom({ kind: 'default' }, []);
  assert.equal(open.blocked, false);
  const blocked = workspaceAvailabilityFrom(
    { kind: 'cloud_folder', cloudFolderId: 'c1' },
    [{ path: '/cache', ok: false, code: 'WORKSPACE_UNAVAILABLE' }]
  );
  assert.equal(blocked.blocked, true);
  assert.match(String(blocked.reason), /工作区根不可用/);
});

test('picker encode/decode and binding conversion', () => {
  assert.equal(encodeWorkspacePickerValue({ kind: 'default' }), 'default');
  assert.equal(encodeWorkspacePickerValue({ kind: 'new_project' }), '__new_project');
  assert.deepEqual(decodeWorkspacePickerValue('project:p1'), { kind: 'project', projectId: 'p1' });
  assert.deepEqual(decodeWorkspacePickerValue('cloud:c1'), {
    kind: 'cloud_folder',
    cloudFolderId: 'c1'
  });
  assert.deepEqual(decodeWorkspacePickerValue('nope'), { kind: 'default' });
  assert.deepEqual(pickerValueFromBinding({ kind: 'project', projectId: 'p1' }), {
    kind: 'project',
    projectId: 'p1'
  });
  assert.equal(bindingFromPickerValue({ kind: 'new_cloud' }), null);
  assert.deepEqual(bindingFromPickerValue({ kind: 'cloud_folder', cloudFolderId: 'c1' }), {
    kind: 'cloud_folder',
    cloudFolderId: 'c1'
  });
});

test('validate new project / cloud drafts', () => {
  assert.deepEqual(validateNewProjectDraft('', [{ path: '/a' }]), {
    ok: false,
    error: '请填写 Project 名称'
  });
  assert.deepEqual(validateNewProjectDraft('app', []), {
    ok: false,
    error: '至少添加一个本地根目录'
  });
  assert.deepEqual(validateNewProjectDraft('app', [{ path: '/a' }, { path: '/a' }]), {
    ok: false,
    error: '根目录路径不能重复'
  });
  assert.deepEqual(
    validateNewProjectDraft('app', [
      { path: '/a', alias: 'fe' },
      { path: '/b', alias: 'fe' }
    ]),
    { ok: false, error: '根目录别名不能重复' }
  );
  assert.deepEqual(validateNewProjectDraft('app', [{ path: '/a', alias: 'fe' }]), { ok: true });
  assert.deepEqual(validateNewCloudDraft('  '), { ok: false, error: '请填写云端 Folder 名称' });
  assert.deepEqual(validateNewCloudDraft('notes'), { ok: true });
});

test('parse catalog and fs responses', () => {
  const projects = parseProjectsResponse({
    projects: [
      {
        id: 'p1',
        name: 'App',
        roots: [{ id: 'r1', path: '/fe', alias: 'frontend', is_primary: true }]
      }
    ]
  });
  assert.equal(projects[0]?.roots[0]?.isPrimary, true);
  assert.equal(parseCreatedProject({ project: { id: 'p2', name: 'B', roots: [] } })?.id, 'p2');

  const folders = parseCloudFoldersResponse({
    cloud_folders: [{ id: 'c1', name: 'Docs', backend: 's3', local_path: '/cache/c1' }]
  });
  assert.deepEqual(folders[0], {
    id: 'c1',
    name: 'Docs',
    backend: 's3',
    localPath: '/cache/c1'
  });
  assert.equal(parseCreatedCloudFolder({ id: 'c2', name: 'X', backend: 'local' })?.id, 'c2');
  assert.equal(
    parseCloudFoldersResponse({
      folders: [{ id: 'c3', name: 'Y', backend: 'local', localPath: '/cache/c3' }]
    })[0]?.id,
    'c3'
  );
  assert.equal(parseCreatedCloudFolder({ folder: { id: 'c4', name: 'Z', backend: 's3' } })?.id, 'c4');

  assert.deepEqual(parseFsValidate({ ok: true, real_path: '/real' }), {
    ok: true,
    realPath: '/real',
    error: undefined,
    code: undefined
  });
  assert.deepEqual(parseFsValidate({ ok: true, path: '/canonical' }), {
    ok: true,
    realPath: '/canonical',
    error: undefined,
    code: undefined
  });
  assert.deepEqual(parseFsValidate({ ok: false, code: 'not_found', message: 'Directory not found: /gone' }), {
    ok: false,
    realPath: undefined,
    error: 'Directory not found: /gone',
    code: 'not_found'
  });
  const browse = parseFsBrowse({
    path: '/tmp',
    parent: '/',
    entries: [
      { name: 'a', kind: 'dir' },
      { name: 'b.txt', kind: 'file' },
      { name: '' }
    ]
  });
  assert.equal(browse.entries.length, 2);
  assert.equal(browse.entries[1]?.kind, 'file');

  const backendBrowse = parseFsBrowse({
    path: '/Users/me',
    entries: [
      { name: 'src', isDir: true, path: '/Users/me/src' },
      { name: 'readme.md', isDir: false, path: '/Users/me/readme.md' }
    ]
  });
  assert.equal(backendBrowse.parent, '/Users');
  assert.equal(backendBrowse.entries[0]?.kind, 'dir');
  assert.equal(backendBrowse.entries[0]?.path, '/Users/me/src');
  assert.equal(backendBrowse.entries[1]?.kind, 'file');
  assert.equal(childBrowsePath('/Users/me', backendBrowse.entries[0]!), '/Users/me/src');
  assert.equal(parentDirOf('/'), undefined);
  assert.equal(parentDirOf('/tmp'), '/');
});

test('labels and root list', () => {
  assert.equal(workspaceBindingLabel({ kind: 'default' }), '默认');
  assert.equal(
    workspaceBindingLabel({ kind: 'project', projectId: 'p' }, { projectName: 'App' }),
    'Project · App'
  );
  assert.equal(formatRootList([{ alias: 'fe', path: '/fe' }, { path: '/be' }]), '@fe /fe · /be');
});
