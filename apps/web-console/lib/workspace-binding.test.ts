import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindingFromPickerValue,
  basenameFromPath,
  decodeWorkspacePickerValue,
  defaultProjectNameFromRoots,
  encodeWorkspacePickerValue,
  formatRootList,
  formatUnavailableMessage,
  normalizeRootPath,
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
  rootPathTaken,
  shortPath,
  validateNewCloudDraft,
  validateNewProjectDraft,
  workspaceAvailabilityFrom,
  workspaceBindingBody,
  workspaceBindingLabel,
  workspaceBindingsEqual,
  translateWorkspaceBlock,
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
  assert.deepEqual(workspaceSendBlockReason({ binding: { kind: 'project' }, roots: [] }), {
    code: 'project_unselected'
  });
  const reason = workspaceSendBlockReason({
    binding: { kind: 'project', projectId: 'p1' },
    roots: [{ path: '/gone', alias: 'app', ok: false, error: 'ENOENT' }]
  });
  assert.deepEqual(reason, {
    code: 'roots_unavailable',
    bound: false,
    names: 'app',
    detail: 'ENOENT'
  });

  const sealed = formatUnavailableMessage(
    [{ path: '/gone', alias: 'app', ok: false, error: 'ENOENT' }],
    true
  );
  assert.equal(sealed.code, 'roots_unavailable');
  assert.equal(sealed.bound, true);

  assert.deepEqual(
    workspaceSendBlockReason({
      binding: { kind: 'project', projectId: 'p1' },
      roots: [],
      checking: false
    }),
    { code: 'project_empty', bound: false }
  );
  assert.equal(
    workspaceSendBlockReason({
      binding: { kind: 'project', projectId: 'p1' },
      roots: [],
      checking: true
    }),
    null
  );
  assert.equal(
    workspaceSendBlockReason({
      binding: { kind: 'project', projectId: 'p1' },
      roots: [{ path: '/gone', ok: false }],
      checking: true
    })?.code,
    'roots_unavailable'
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
  assert.equal(open.block, null);
  const blocked = workspaceAvailabilityFrom(
    { kind: 'cloud_folder', cloudFolderId: 'c1' },
    [{ path: '/cache', ok: false, code: 'WORKSPACE_UNAVAILABLE' }]
  );
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.block?.code, 'roots_unavailable');
  assert.equal(blocked.reason, 'roots_unavailable');
  const copy: Record<string, string> = {
    'play.workspacePicker.blockUnavailable': 'BAD {names}{detail}',
    'play.workspacePicker.blockDetail': ' ({detail})',
    'play.workspacePicker.unknownRoot': 'unknown'
  };
  assert.equal(
    translateWorkspaceBlock(blocked.block!, (key, vars) => {
      const template = copy[key] ?? key;
      return template
        .replace('{names}', String(vars?.names ?? ''))
        .replace('{detail}', String(vars?.detail ?? ''));
    }),
    'BAD /cache'
  );
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
    error: 'name_required'
  });
  assert.deepEqual(validateNewProjectDraft('app', []), {
    ok: false,
    error: 'root_required'
  });
  assert.deepEqual(validateNewProjectDraft('app', [{ path: '/a' }, { path: '/a/' }]), {
    ok: false,
    error: 'root_path_dup'
  });
  assert.deepEqual(
    validateNewProjectDraft('app', [
      { path: '/a', alias: 'fe' },
      { path: '/b', alias: 'fe' }
    ]),
    { ok: false, error: 'root_alias_dup' }
  );
  assert.deepEqual(validateNewProjectDraft('app', [{ path: '/a', alias: 'fe' }]), { ok: true });
  assert.deepEqual(validateNewCloudDraft('  '), { ok: false, error: 'name_required' });
  assert.deepEqual(validateNewCloudDraft('notes'), { ok: true });
});

test('path helpers for multi-root picker', () => {
  assert.equal(normalizeRootPath('/tmp/app/'), '/tmp/app');
  assert.equal(basenameFromPath('/Users/me/src/app'), 'app');
  assert.equal(basenameFromPath('C:\\work\\docs\\'), 'docs');
  assert.equal(defaultProjectNameFromRoots([{ path: '/srv/www', alias: 'web' }]), 'web');
  assert.equal(defaultProjectNameFromRoots([{ path: '/srv/www/' }]), 'www');
  assert.equal(rootPathTaken([{ path: '/a' }, { path: '/b/' }], '/b'), true);
  assert.equal(rootPathTaken([{ path: '/a' }], '/c'), false);
  assert.equal(shortPath('/short'), '/short');
  assert.equal(shortPath('/very/long/absolute/path/to/project/src', 16).startsWith('…'), true);
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
  assert.equal(workspaceBindingLabel({ kind: 'default' }), 'Default');
  assert.equal(
    workspaceBindingLabel({ kind: 'project', projectId: 'p' }, { projectName: 'App' }),
    'Project · App'
  );
  assert.equal(
    workspaceBindingLabel(
      { kind: 'cloud_folder', cloudFolderId: 'c' },
      { cloudFolderName: 'Docs' },
      { defaultLabel: '默认', project: 'Project', cloud: '云端' }
    ),
    '云端 · Docs'
  );
  assert.equal(formatRootList([{ alias: 'fe', path: '/fe' }, { path: '/be' }]), '@fe /fe · /be');
  assert.equal(
    parseCreatedProject({
      root: { id: 'r2', path: '/extra' },
      project: {
        id: 'p3',
        name: 'Multi',
        roots: [
          { id: 'r1', path: '/fe', alias: 'fe', isPrimary: true },
          { id: 'r2', path: '/extra', alias: 'extra' }
        ]
      }
    })?.roots.length,
    2
  );
});
