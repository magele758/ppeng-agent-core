import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fileUriForLocalPath,
  parseLocalSourceFile,
  shouldSkipScanDirEntry
} from '../local-source-parse.mjs';

test('parseLocalSourceFile prefers http links over file fallback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evo-ls-'));
  const p = join(dir, 'x.md');
  writeFileSync(p, '# T\n\nSee [u](https://example.com/a)\n', 'utf8');
  const items = parseLocalSourceFile(p);
  assert.equal(items.length, 1);
  assert.equal(items[0].link, 'https://example.com/a');
  rmSync(dir, { recursive: true, force: true });
});

test('parseLocalSourceFile uses whole file as file:// when no outbound links', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evo-ls-'));
  const p = join(dir, 'note.md');
  writeFileSync(p, '# My Note\n\nBody only.\n', 'utf8');
  const items = parseLocalSourceFile(p);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'My Note');
  assert.equal(items[0].link, fileUriForLocalPath(p));
  assert.ok(items[0].link.startsWith('file:'));
  rmSync(dir, { recursive: true, force: true });
});

test('shouldSkipScanDirEntry skips .obsidian and hidden dirs', () => {
  assert.equal(shouldSkipScanDirEntry('.obsidian', true), true);
  assert.equal(shouldSkipScanDirEntry('Inbox', true), false);
});
