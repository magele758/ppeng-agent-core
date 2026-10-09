import test from 'node:test';
import assert from 'node:assert/strict';
import { filterSettingsEntries, matchesQuery } from './settings-search.ts';
import { readStoredAdvanced, writeStoredAdvanced } from './advanced-mode.ts';

const entries = [
  { id: 'lang', haystack: '语言 language 界面语言' },
  { id: 'sandbox', haystack: '沙箱 sandbox 安全' },
  { id: 'jev', haystack: 'Jev 评估 eval', advanced: true }
];

test('默认只显示常用项，开启高级后显示全部 [AC:console-settings#AC-1]', () => {
  assert.deepEqual(filterSettingsEntries(entries, '', false).map((e) => e.id), ['lang', 'sandbox']);
  assert.deepEqual(filterSettingsEntries(entries, '', true).map((e) => e.id), ['lang', 'sandbox', 'jev']);
});

test('搜索只保留匹配项，且命中的高级项自动出现 [AC:console-settings#AC-2]', () => {
  assert.deepEqual(filterSettingsEntries(entries, 'sandbox', false).map((e) => e.id), ['sandbox']);
  assert.deepEqual(filterSettingsEntries(entries, 'EVAL', false).map((e) => e.id), ['jev']);
  assert.deepEqual(filterSettingsEntries(entries, '语言 language', false).map((e) => e.id), ['lang']);
});

test('无匹配返回空列表 [AC:console-settings#AC-3]', () => {
  assert.deepEqual(filterSettingsEntries(entries, 'zzz-none', true), []);
  assert.equal(matchesQuery('abc', ''), true);
});

test('高级开关偏好可持久化与读取 [AC:console-settings#AC-4]', () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v)
  };
  assert.equal(readStoredAdvanced(storage), false);
  writeStoredAdvanced(storage, true);
  assert.equal(readStoredAdvanced(storage), true);
  writeStoredAdvanced(storage, false);
  assert.equal(readStoredAdvanced(storage), false);
});
