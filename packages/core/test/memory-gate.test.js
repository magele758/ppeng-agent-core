import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateMemoryWrite,
  isTrivialChitchat,
  meetsTaskExperienceDepth,
  shouldPersistTaskMemory
} from '../dist/memory/memory-gate.js';

test('gate rejects trivial chitchat', () => {
  assert.equal(isTrivialChitchat('你好'), true);
  assert.equal(isTrivialChitchat('hello'), true);
  assert.equal(isTrivialChitchat('请记住我叫张三，职业是工程师'), false);
  const d = evaluateMemoryWrite({ value: '你好', kind: 'scratch' });
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'trivial_chitchat');
});

test('gate rejects shallow execution when toolsUsed is explicit', () => {
  assert.equal(meetsTaskExperienceDepth({ toolsUsed: ['bash'] }), false);
  assert.equal(meetsTaskExperienceDepth({ toolsUsed: ['bash', 'read_file', 'grep'] }), true);
  assert.equal(meetsTaskExperienceDepth({}), true);

  const d = evaluateMemoryWrite({
    value: '用户任务已经跑完并且产出了可用的部署说明和回滚步骤。',
    taskContent: '帮我把服务部署到预发并写回滚说明',
    kind: 'task',
    toolsUsed: ['bash'],
    minTaskTools: 3
  });
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'shallow_execution');
});

test('gate rejects low-value task memory', () => {
  assert.equal(shouldPersistTaskMemory('hi', 'hi', { toolsUsed: [] }), false);
  const d = evaluateMemoryWrite({
    value: '测试一下',
    kind: 'semantic'
  });
  assert.equal(d.allow, false);
});

test('gate allows user correction and real notes', () => {
  const corr = evaluateMemoryWrite({ value: '不对，应该是改成暗色主题', kind: 'scratch' });
  assert.equal(corr.allow, true);
  const note = evaluateMemoryWrite({
    value: '部署预发需要先跑 migrate 再切流量',
    key: 'deploy.notes',
    kind: 'scratch'
  });
  assert.equal(note.allow, true);
});
