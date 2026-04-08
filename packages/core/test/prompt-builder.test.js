import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// We test the PromptBuilder class's buildStablePrefix method which is
// pure string construction with no I/O dependencies.

// Import internals via dist since tests are .js and core is compiled.
const { PromptBuilder } = await import('../dist/model/prompt-builder.js');

function makeCtx(overrides = {}) {
  return {
    agent: {
      id: 'test-agent',
      name: 'TestBot',
      role: 'assistant',
      instructions: 'Be helpful.',
      capabilities: [],
      harnessRole: undefined,
      ...overrides.agent,
    },
    session: {
      id: 'sess-1',
      mode: 'chat',
      todo: [],
      summary: '',
      ...overrides.session,
    },
    repoRoot: '/repo',
    workspaceRoot: overrides.workspaceRoot ?? undefined,
    task: overrides.task ?? undefined,
  };
}

// Stub minimal deps — buildStablePrefix doesn't need store/repoRoot
const builder = new PromptBuilder({ store: {}, repoRoot: '/repo' });

describe('PromptBuilder.buildStablePrefix', () => {
  it('includes agent name and role', () => {
    const prefix = builder.buildStablePrefix(makeCtx());
    assert.ok(prefix.includes('TestBot'));
    assert.ok(prefix.includes('assistant'));
  });

  it('includes agent instructions', () => {
    const prefix = builder.buildStablePrefix(makeCtx());
    assert.ok(prefix.includes('Be helpful.'));
  });

  it('includes repo root', () => {
    const prefix = builder.buildStablePrefix(makeCtx());
    assert.ok(prefix.includes('Repository root: /repo'));
  });

  it('includes workspace root when provided', () => {
    const prefix = builder.buildStablePrefix(makeCtx({ workspaceRoot: '/ws' }));
    assert.ok(prefix.includes('Workspace root: /ws'));
  });

  it('says no workspace when not provided', () => {
    const prefix = builder.buildStablePrefix(makeCtx());
    assert.ok(prefix.includes('No isolated workspace bound'));
  });

  it('includes conversation mode', () => {
    const prefix = builder.buildStablePrefix(makeCtx({ session: { mode: 'task' } }));
    assert.ok(prefix.includes('Conversation mode: task'));
  });

  it('includes planner harness role', () => {
    const prefix = builder.buildStablePrefix(makeCtx({ agent: { harnessRole: 'planner' } }));
    assert.ok(prefix.includes('Harness role: PLANNER'));
  });

  it('includes generator harness role', () => {
    const prefix = builder.buildStablePrefix(makeCtx({ agent: { harnessRole: 'generator' } }));
    assert.ok(prefix.includes('Harness role: GENERATOR'));
  });

  it('includes evaluator harness role', () => {
    const prefix = builder.buildStablePrefix(makeCtx({ agent: { harnessRole: 'evaluator' } }));
    assert.ok(prefix.includes('Harness role: EVALUATOR'));
  });

  it('includes orchestration line for main agent', () => {
    const prefix = builder.buildStablePrefix(makeCtx({ agent: { id: 'main', capabilities: [] } }));
    assert.ok(prefix.includes('Long-running harness'));
  });

  it('includes orchestration line for agent with orchestration capability', () => {
    const prefix = builder.buildStablePrefix(makeCtx({ agent: { capabilities: ['orchestration'] } }));
    assert.ok(prefix.includes('Long-running harness'));
  });

  it('omits harness role lines for basic agents', () => {
    const prefix = builder.buildStablePrefix(makeCtx());
    assert.ok(!prefix.includes('Harness role:'));
  });
});
