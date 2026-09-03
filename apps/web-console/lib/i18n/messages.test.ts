import test from 'node:test';
import assert from 'node:assert/strict';
import { en } from './messages/en/index.ts';
import { zh } from './messages/zh/index.ts';

function collectLeafKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [];
  const keys: string[] = [];
  for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${name}` : name;
    if (typeof child === 'string') {
      keys.push(path);
    } else {
      keys.push(...collectLeafKeys(child, path));
    }
  }
  return keys.sort();
}

test('en and zh leaf key sets are identical', () => {
  const zhKeys = collectLeafKeys(zh);
  const enKeys = collectLeafKeys(en);
  assert.deepEqual(enKeys, zhKeys);
  assert.ok(zhKeys.includes('common.language'));
  assert.ok(zhKeys.includes('common.languageHint'));
  assert.ok(zhKeys.includes('nav.workbench'));
  assert.ok(zhKeys.includes('play.send'));
  assert.ok(zhKeys.includes('more.approvalsTitle'));
});
