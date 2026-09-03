import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileContextPack,
  compileTurnAppendix,
  formatCompiledContextPack,
  MEMORY_CONTEXT_APPENDIX_PREFIX
} from '../dist/session/context-compiler.js';

test('compiler omits empty slots', () => {
  const pack = compileContextPack({
    userProfile: '',
    core: '',
    working: '## 相关工作记忆\n\n- plan: step 1',
    workingFile: ''
  }, 'plan');
  assert.equal(pack.sections.length, 1);
  assert.equal(pack.sections[0].id, 'working');
  assert.ok(pack.combined.includes('plan: step 1'));
  assert.ok(!pack.combined.includes('用户画像'));
  assert.ok(!pack.combined.includes('日文件'));
});

test('compiler omits everything when all slots empty', () => {
  const pack = compileContextPack({ userProfile: '', core: '', working: '', workingFile: '' }, 'x');
  assert.equal(pack.sections.length, 0);
  assert.equal(formatCompiledContextPack(pack), '');
});

test('formatted pack uses user-side prefix', () => {
  const text = formatCompiledContextPack(
    compileContextPack({ userProfile: '## 用户画像\n\n- 称呼：Ada', core: '', working: '', workingFile: '' }, '')
  );
  assert.ok(text.startsWith(MEMORY_CONTEXT_APPENDIX_PREFIX));
  assert.ok(text.includes('Ada'));
});

test('compileTurnAppendix uses session memory as working slot', () => {
  const session = {
    id: 'sess-1',
    title: 't',
    mode: 'chat',
    status: 'idle',
    agentId: 'general',
    background: false,
    todo: [],
    metadata: {},
    createdAt: '',
    updatedAt: ''
  };
  const appendix = compileTurnAppendix({
    session,
    query: 'plan',
    store: {
      listSessionMemory() {
        return [{ scope: 'scratch', key: 'plan', value: 'step 1' }];
      }
    }
  });
  assert.ok(appendix.includes(MEMORY_CONTEXT_APPENDIX_PREFIX));
  assert.ok(appendix.includes('plan: step 1'));
});
