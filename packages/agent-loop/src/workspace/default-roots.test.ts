import { describe, it, expect } from 'vitest';
import { defaultWorkspaceRoots } from './default-roots.js';

describe('workspace/default-roots', () => {
  it('uses workspaceRoot when provided', () => {
    expect(defaultWorkspaceRoots('/tmp/ws', '/repo')).toEqual([
      { alias: 'repo', path: '/tmp/ws', primary: true }
    ]);
  });

  it('falls back to repoRoot when workspaceRoot is undefined', () => {
    expect(defaultWorkspaceRoots(undefined, '/repo')).toEqual([
      { alias: 'repo', path: '/repo', primary: true }
    ]);
  });

  it('keeps an empty workspaceRoot (?? does not treat "" as missing)', () => {
    expect(defaultWorkspaceRoots('', '/repo')).toEqual([
      { alias: 'repo', path: '', primary: true }
    ]);
  });
});
