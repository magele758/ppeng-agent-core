import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyUnboundWorkspaceBindingPatch,
  inheritWorkspaceBinding,
  isBlockedPath,
  parseWorkspaceBinding,
  parseWorkspacePathInput,
  resolvePathAgainstRoots,
  sanitizeAlias,
  sealWorkspaceBindingPatch,
  uniqueAlias,
  validateWorkspaceRootPath,
  workspaceBindingFromMetadata
} from '../dist/workspace/index.js';

test('parseWorkspaceBinding rejects incomplete project / cloud', () => {
  assert.equal(parseWorkspaceBinding('nope'), undefined);
  assert.equal(parseWorkspaceBinding({ kind: 'project' }), undefined);
  assert.equal(parseWorkspaceBinding({ kind: 'cloud_folder' }), undefined);
  assert.deepEqual(parseWorkspaceBinding({ kind: 'project', projectId: 'p1' }), {
    kind: 'project',
    projectId: 'p1'
  });
  assert.deepEqual(workspaceBindingFromMetadata({}), { kind: 'default' });
});

test('unbound patch applies; bound patch is write-once', () => {
  const first = applyUnboundWorkspaceBindingPatch({}, { kind: 'project', projectId: 'p1' });
  assert.equal(first.ok, true);
  if (first.ok) assert.deepEqual(first.patch.workspaceBinding, { kind: 'project', projectId: 'p1' });

  const sealed = sealWorkspaceBindingPatch({}, { kind: 'project', projectId: 'p1' });
  assert.equal(sealed.workspaceBindingBound, true);

  const blocked = applyUnboundWorkspaceBindingPatch(sealed, { kind: 'default' });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.reason, 'bound');

  const same = applyUnboundWorkspaceBindingPatch(sealed, { kind: 'project', projectId: 'p1' });
  assert.equal(same.ok, true);

  assert.deepEqual(sealWorkspaceBindingPatch({}, { kind: 'default' }), {});
  const leftoverDefault = applyUnboundWorkspaceBindingPatch(
    { workspaceBinding: { kind: 'default' }, workspaceBindingBound: true },
    { kind: 'cloud_folder', cloudFolderId: 'c1' }
  );
  assert.equal(leftoverDefault.ok, true);
});

test('inheritWorkspaceBinding copies sealed project from parent', () => {
  assert.deepEqual(inheritWorkspaceBinding({ workspaceBinding: { kind: 'default' } }), {});
  const patch = inheritWorkspaceBinding({
    workspaceBinding: { kind: 'project', projectId: 'p1' },
    workspaceBindingBound: true
  });
  assert.deepEqual(patch.workspaceBinding, { kind: 'project', projectId: 'p1' });
  assert.equal(patch.workspaceBindingBound, true);
});

test('blocked paths include home secrets and /etc', () => {
  const home = '/Users/someone';
  assert.equal(isBlockedPath(`${home}/.ssh/id_rsa`, home), true);
  assert.equal(isBlockedPath('/etc/passwd', home), true);
  assert.equal(isBlockedPath('/tmp/ok', home), false);
});

test('validateWorkspaceRootPath rejects relative and files', async () => {
  const rel = await validateWorkspaceRootPath('relative/path');
  assert.equal(rel.ok, false);
  if (!rel.ok) assert.equal(rel.code, 'not_absolute');

  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ws-ok-')));
  const ok = await validateWorkspaceRootPath(dir);
  assert.equal(ok.ok, true, ok.ok ? '' : ok.message);

  const file = join(dir, 'x.txt');
  writeFileSync(file, 'x');
  const notDir = await validateWorkspaceRootPath(file);
  assert.equal(notDir.ok, false);
  if (!notDir.ok) assert.equal(notDir.code, 'not_directory');
});

test('alias sanitize / unique and path resolve stay inside roots', () => {
  assert.equal(sanitizeAlias('Front End!!'), 'front-end');
  assert.equal(uniqueAlias('app', ['app', 'app-2']), 'app-3');
  assert.deepEqual(parseWorkspacePathInput('@fe/src/a.ts'), {
    kind: 'alias',
    alias: 'fe',
    rest: 'src/a.ts'
  });

  const fe = realpathSync(mkdtempSync(join(tmpdir(), 'ws-fe-')));
  const be = realpathSync(mkdtempSync(join(tmpdir(), 'ws-be-')));
  const roots = [
    { alias: 'fe', path: fe, primary: true },
    { alias: 'be', path: be }
  ];
  const inside = resolvePathAgainstRoots(roots, '@fe/src');
  assert.ok(inside.startsWith(fe), inside);
  assert.throws(() => resolvePathAgainstRoots(roots, '/etc/passwd'), /escapes workspace/);
  assert.throws(() => resolvePathAgainstRoots(roots, '@nope/x'), /Unknown workspace alias/);
});
