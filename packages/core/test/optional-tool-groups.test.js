import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterToolsByOptionalGroups,
  resolveOptionalToolGroups,
  optionalToolNamesFromGroups,
  loadOptionalToolGroupsFromEnv
} from '../dist/tools/optional-tool-groups.js';

const sampleGroups = loadOptionalToolGroupsFromEnv({});

test('filterToolsByOptionalGroups keeps non-optional always', () => {
  const tools = [{ name: 'read_file' }, { name: 'bash' }];
  const { tools: out } = filterToolsByOptionalGroups(tools, [], sampleGroups);
  assert.deepEqual(
    out.map((t) => t.name),
    ['read_file']
  );
});

test('filterToolsByOptionalGroups enables optional when group selected', () => {
  const tools = [{ name: 'read_file' }, { name: 'bash' }];
  const { tools: out, resolved } = filterToolsByOptionalGroups(tools, ['shell'], sampleGroups);
  assert.deepEqual(resolved.enabledGroups, ['shell']);
  assert.ok(out.some((t) => t.name === 'bash'));
});

test('resolveOptionalToolGroups reports unknown groups', () => {
  const r = resolveOptionalToolGroups(['shell', 'nope'], sampleGroups);
  assert.ok(r.enabledGroups.includes('shell'));
  assert.ok(r.unknownGroups.includes('nope'));
});

test('optionalToolNamesFromGroups covers configured tools', () => {
  const s = optionalToolNamesFromGroups(sampleGroups);
  assert.ok(s.has('bash'));
  assert.ok(s.has('web_fetch'));
});
