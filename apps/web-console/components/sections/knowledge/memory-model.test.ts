import test from 'node:test';
import assert from 'node:assert/strict';
import { canAddMemory, filterMemoryEntries, MEMORY_SCOPES, scopeNeedsSession } from './memory-model.ts';
import { en } from '../../../lib/i18n/messages/en/index.ts';
import { zh } from '../../../lib/i18n/messages/zh/index.ts';

const entries = [
  { id: '1', scope: 'user.memory', key: 'favorite_language', value: 'TypeScript' },
  { id: '2', scope: 'user.memory', key: 'timezone', value: 'Asia/Shanghai' },
  { id: '3', scope: 'user.memory', key: 'tone', value: 'concise, typescript examples' }
];

test('列出五种记忆范围，且每个范围都有中英文说明 [AC:console-knowledge#AC-1]', () => {
  assert.deepEqual(
    MEMORY_SCOPES.map((s) => s.id),
    ['session.scratch', 'session.long', 'user.memory', 'team.memory', 'project.memory']
  );
  for (const s of MEMORY_SCOPES) {
    for (const messages of [zh, en]) {
      const scopes = messages.memory.scopes as Record<string, { label: string; desc: string }>;
      assert.ok(scopes[s.slug]?.label.length > 0, `${s.id} label`);
      assert.ok(scopes[s.slug]?.desc.length > 0, `${s.id} desc`);
    }
  }
});

test('记忆搜索匹配键或内容，忽略大小写 [AC:console-knowledge#AC-2]', () => {
  assert.deepEqual(filterMemoryEntries(entries, 'TYPESCRIPT').map((e) => e.id), ['1', '3']);
  assert.deepEqual(filterMemoryEntries(entries, 'zone').map((e) => e.id), ['2']);
  assert.equal(filterMemoryEntries(entries, '').length, 3);
  assert.equal(filterMemoryEntries(entries, 'nothing-here').length, 0);
});

test('键或内容为空（含纯空白）时不可添加 [AC:console-knowledge#AC-3]', () => {
  assert.equal(canAddMemory({ key: 'a', value: 'b' }), true);
  assert.equal(canAddMemory({ key: '  ', value: 'b' }), false);
  assert.equal(canAddMemory({ key: 'a', value: '' }), false);
});

test('会话范围需要选中会话才能添加 [AC:console-knowledge#AC-3]', () => {
  assert.equal(scopeNeedsSession('session.scratch'), true);
  assert.equal(scopeNeedsSession('session.long'), true);
  assert.equal(scopeNeedsSession('user.memory'), false);
});
