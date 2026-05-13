import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { globWorkspaceFiles, shouldExcludeGlobRelPath } from '../dist/tools/glob-files.js';
import { fetchUrlText, webSearchFromEnv } from '../dist/tools/web-fetch.js';
import { mergeApprovalPolicies, filePolicyRequiresBashApproval } from '../dist/approval/policy-loader.js';

test('globWorkspaceFiles finds ts files', async () => {
  const dir = join(tmpdir(), `raw-agent-glob-${Date.now()}`);
  await mkdir(join(dir, 'a'), { recursive: true });
  await writeFile(join(dir, 'a', 'x.ts'), '//x', 'utf8');
  await writeFile(join(dir, 'root.md'), '#', 'utf8');
  const r = await globWorkspaceFiles({ cwd: dir, pattern: '**/*.ts', maxResults: 50 });
  assert.ok(r.ok);
  assert.ok(r.content.includes('a/x.ts'));
});

test('shouldExcludeGlobRelPath skips obsidian/git/deps segments', () => {
  assert.equal(shouldExcludeGlobRelPath('.obsidian/workspace.json'), true);
  assert.equal(shouldExcludeGlobRelPath('wiki/.obsidian/app.json'), true);
  assert.equal(shouldExcludeGlobRelPath('node_modules/foo/bar.md'), true);
  assert.equal(shouldExcludeGlobRelPath('.git/HEAD'), true);
  assert.equal(shouldExcludeGlobRelPath('wiki/notes/hello.md'), false);
  assert.equal(shouldExcludeGlobRelPath('wiki/node_modules-topic.md'), false);
});

test('globWorkspaceFiles skips .obsidian and node_modules trees', async () => {
  const dir = join(tmpdir(), `raw-agent-glob-vault-${Date.now()}`);
  await mkdir(join(dir, 'wiki'), { recursive: true });
  await writeFile(join(dir, 'wiki', 'index.md'), '#', 'utf8');
  await mkdir(join(dir, '.obsidian'), { recursive: true });
  await writeFile(join(dir, '.obsidian', 'app.json'), '{}', 'utf8');
  await mkdir(join(dir, 'node_modules', 'x'), { recursive: true });
  await writeFile(join(dir, 'node_modules', 'x', 'readme.md'), '#', 'utf8');
  const r = await globWorkspaceFiles({ cwd: dir, pattern: '**/*.md', maxResults: 50 });
  assert.ok(r.ok);
  assert.ok(r.content.includes('wiki/index.md'));
  assert.equal(r.content.includes('.obsidian'), false);
  assert.equal(r.content.includes('node_modules'), false);
});

test('fetchUrlText blocks private IP by default', async () => {
  const r = await fetchUrlText({ url: 'http://127.0.0.1:9/' });
  assert.equal(r.ok, false);
  assert.ok(r.content.includes('private') || r.content.includes('Refused'));
});

test('mergeApprovalPolicies combines rules', () => {
  const m = mergeApprovalPolicies(
    { bashCommandPatterns: [{ pattern: 'rm -rf', when: 'always' }] },
    { rules: [{ toolPattern: 'bash', match: 'exact', when: 'always' }] }
  );
  assert.ok(m?.rules?.length);
  assert.ok(filePolicyRequiresBashApproval(m, 'rm -rf /'));
});

test('webSearchFromEnv without URL', async () => {
  const r = await webSearchFromEnv({}, { query: 'test' });
  assert.equal(r.ok, false);
  assert.ok(r.content.includes('RAW_AGENT_WEB_SEARCH_URL') || r.content.includes('not configured'));
});
