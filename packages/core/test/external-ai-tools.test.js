import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createExternalAiTools } from '../dist/tools/external-ai-tools.js';

const EXPECTED_NAMES = ['claude_code', 'codex_exec', 'cursor_agent'];

// ---------------------------------------------------------------------------
// createExternalAiTools – return value
// ---------------------------------------------------------------------------
describe('createExternalAiTools – basics', () => {
  it('returns an array', () => {
    const tools = createExternalAiTools();
    assert.ok(Array.isArray(tools));
  });

  it('returns exactly 3 tools', () => {
    const tools = createExternalAiTools();
    assert.equal(tools.length, 3);
  });

  it('tool names match expected set', () => {
    const tools = createExternalAiTools();
    const names = tools.map((t) => t.name);
    assert.deepStrictEqual(names, EXPECTED_NAMES);
  });
});

// ---------------------------------------------------------------------------
// Tool contract shape
// ---------------------------------------------------------------------------
describe('createExternalAiTools – tool contract shape', () => {
  const tools = createExternalAiTools();

  for (const name of EXPECTED_NAMES) {
    it(`${name} has required "name" property`, () => {
      const tool = tools.find((t) => t.name === name);
      assert.ok(tool, `tool ${name} not found`);
      assert.equal(typeof tool.name, 'string');
    });

    it(`${name} has a non-empty description`, () => {
      const tool = tools.find((t) => t.name === name);
      assert.ok(tool.description);
      assert.equal(typeof tool.description, 'string');
      assert.ok(tool.description.length > 0);
    });

    it(`${name} has an inputSchema object`, () => {
      const tool = tools.find((t) => t.name === name);
      assert.equal(typeof tool.inputSchema, 'object');
      assert.ok(tool.inputSchema !== null);
    });

    it(`${name} has an execute function`, () => {
      const tool = tools.find((t) => t.name === name);
      assert.equal(typeof tool.execute, 'function');
    });

    it(`${name} has isExternal set to true`, () => {
      const tool = tools.find((t) => t.name === name);
      assert.equal(tool.isExternal, true);
    });
  }
});

// ---------------------------------------------------------------------------
// Input schema validation
// ---------------------------------------------------------------------------
describe('createExternalAiTools – input schema', () => {
  const tools = createExternalAiTools();

  for (const name of EXPECTED_NAMES) {
    it(`${name} schema type is "object"`, () => {
      const tool = tools.find((t) => t.name === name);
      assert.equal(tool.inputSchema.type, 'object');
    });

    it(`${name} schema has "prompt" in properties`, () => {
      const tool = tools.find((t) => t.name === name);
      assert.ok(tool.inputSchema.properties.prompt, `${name} missing prompt property`);
    });

    it(`${name} schema requires "prompt"`, () => {
      const tool = tools.find((t) => t.name === name);
      assert.ok(
        Array.isArray(tool.inputSchema.required) &&
          tool.inputSchema.required.includes('prompt'),
        `${name} does not list prompt as required`
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Approval / side-effect metadata
// ---------------------------------------------------------------------------
describe('createExternalAiTools – approval metadata', () => {
  const tools = createExternalAiTools();

  for (const name of EXPECTED_NAMES) {
    it(`${name} needsApproval returns true`, () => {
      const tool = tools.find((t) => t.name === name);
      assert.equal(typeof tool.needsApproval, 'function');
      assert.equal(tool.needsApproval(), true);
    });

    it(`${name} approvalMode is "auto"`, () => {
      const tool = tools.find((t) => t.name === name);
      assert.equal(tool.approvalMode, 'auto');
    });

    it(`${name} sideEffectLevel is "workspace"`, () => {
      const tool = tools.find((t) => t.name === name);
      assert.equal(tool.sideEffectLevel, 'workspace');
    });
  }
});
