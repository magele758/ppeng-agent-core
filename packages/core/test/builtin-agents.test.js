import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { builtinAgents } from '../dist/builtin-agents.js';

describe('builtinAgents', () => {
  it('is a non-empty array', () => {
    assert.ok(Array.isArray(builtinAgents));
    assert.ok(builtinAgents.length > 0);
  });

  it('has no duplicate IDs', () => {
    const ids = builtinAgents.map(a => a.id);
    const unique = new Set(ids);
    assert.equal(unique.size, ids.length, `Duplicate IDs found: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);
  });

  it('every agent has required fields', () => {
    for (const agent of builtinAgents) {
      assert.ok(agent.id, `Agent missing id`);
      assert.ok(agent.name, `Agent ${agent.id} missing name`);
      assert.ok(agent.role, `Agent ${agent.id} missing role`);
      assert.ok(agent.instructions, `Agent ${agent.id} missing instructions`);
      assert.ok(Array.isArray(agent.capabilities), `Agent ${agent.id} missing capabilities`);
      assert.ok(agent.capabilities.length > 0, `Agent ${agent.id} has empty capabilities`);
    }
  });

  it('includes expected core agents', () => {
    const ids = builtinAgents.map(a => a.id);
    for (const expected of ['general', 'main', 'self-healer', 'planner', 'generator', 'evaluator']) {
      assert.ok(ids.includes(expected), `Missing expected agent: ${expected}`);
    }
  });

  it('harnessRole is only set on planner/generator/evaluator', () => {
    for (const agent of builtinAgents) {
      if (agent.harnessRole) {
        assert.ok(
          ['planner', 'generator', 'evaluator'].includes(agent.harnessRole),
          `Agent ${agent.id} has unexpected harnessRole: ${agent.harnessRole}`
        );
      }
    }
  });

  it('planner has harnessRole=planner', () => {
    const planner = builtinAgents.find(a => a.id === 'planner');
    assert.equal(planner.harnessRole, 'planner');
  });

  it('generator has harnessRole=generator', () => {
    const gen = builtinAgents.find(a => a.id === 'generator');
    assert.equal(gen.harnessRole, 'generator');
  });

  it('evaluator has harnessRole=evaluator', () => {
    const ev = builtinAgents.find(a => a.id === 'evaluator');
    assert.equal(ev.harnessRole, 'evaluator');
  });

  it('general agent does not have harnessRole', () => {
    const general = builtinAgents.find(a => a.id === 'general');
    assert.equal(general.harnessRole, undefined);
  });

  it('general agent has chat capability', () => {
    const general = builtinAgents.find(a => a.id === 'general');
    assert.ok(general.capabilities.includes('chat'));
  });

  it('main agent has orchestration capability', () => {
    const main = builtinAgents.find(a => a.id === 'main');
    assert.ok(main.capabilities.includes('orchestration'));
  });

  it('self-healer has coding and testing capabilities', () => {
    const sh = builtinAgents.find(a => a.id === 'self-healer');
    assert.ok(sh.capabilities.includes('coding'));
    assert.ok(sh.capabilities.includes('testing'));
  });

  it('every agent has non-empty instructions', () => {
    for (const agent of builtinAgents) {
      assert.ok(agent.instructions.length > 10, `Agent ${agent.id} instructions too short`);
    }
  });

  it('no agent has empty-string name', () => {
    for (const agent of builtinAgents) {
      assert.ok(agent.name.trim().length > 0);
    }
  });
});
