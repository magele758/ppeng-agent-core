import test from 'node:test';
import assert from 'node:assert/strict';
import { en } from '../../../lib/i18n/messages/en/index.ts';
import { zh } from '../../../lib/i18n/messages/zh/index.ts';

function leafKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : leafKeys(v, `${prefix}${k}.`)
  );
}

test('任务页与知识页文案中英文键完全一致且非空 [AC:console-tasks#AC-7]', () => {
  for (const ns of ['tasks', 'knowledge', 'memory'] as const) {
    const zhKeys = leafKeys(zh[ns]).sort();
    const enKeys = leafKeys(en[ns]).sort();
    assert.ok(zhKeys.length > 0, `${ns} has messages`);
    assert.deepEqual(enKeys, zhKeys, `${ns} keys in sync`);
  }
});
