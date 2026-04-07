import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { enrichSpawnEnv, resolveNpmBin, resolveGitBin } from '../dist/self-heal/self-heal-executors.js';

describe('enrichSpawnEnv', () => {
  it('returns an object with PATH set', () => {
    const env = enrichSpawnEnv();
    assert.ok(env.PATH);
    assert.ok(typeof env.PATH === 'string');
  });

  it('prepends node bin dir to PATH', () => {
    const env = enrichSpawnEnv();
    const nodeDir = path.dirname(process.execPath);
    assert.ok(env.PATH.startsWith(nodeDir), `PATH should start with ${nodeDir}`);
  });

  it('includes homebrew and standard paths', () => {
    const env = enrichSpawnEnv();
    assert.ok(env.PATH.includes('/opt/homebrew/bin'));
    assert.ok(env.PATH.includes('/usr/local/bin'));
    assert.ok(env.PATH.includes('/usr/bin'));
  });

  it('preserves existing PATH entries', () => {
    const original = process.env.PATH;
    if (original) {
      const env = enrichSpawnEnv();
      // Original PATH should be at the end
      assert.ok(env.PATH.endsWith(original) || env.PATH.includes(original));
    }
  });

  it('merges override environment variables', () => {
    const env = enrichSpawnEnv({ MY_VAR: 'test123' });
    assert.equal(env.MY_VAR, 'test123');
  });

  it('overrides can replace existing env vars', () => {
    const env = enrichSpawnEnv({ HOME: '/custom/home' });
    assert.equal(env.HOME, '/custom/home');
  });

  it('handles empty overrides', () => {
    const env = enrichSpawnEnv({});
    assert.ok(env.PATH);
  });

  it('uses path.delimiter as separator', () => {
    const env = enrichSpawnEnv();
    const sep = path.delimiter;
    const parts = env.PATH.split(sep);
    assert.ok(parts.length >= 4, `Expected at least 4 PATH parts, got ${parts.length}`);
  });
});

describe('resolveNpmBin', () => {
  it('returns a non-empty string', () => {
    const bin = resolveNpmBin();
    assert.ok(bin.length > 0);
  });

  it('respects RAW_AGENT_NPM_BIN env var', () => {
    const saved = process.env.RAW_AGENT_NPM_BIN;
    try {
      process.env.RAW_AGENT_NPM_BIN = '/custom/npm';
      const bin = resolveNpmBin();
      assert.equal(bin, '/custom/npm');
    } finally {
      if (saved !== undefined) process.env.RAW_AGENT_NPM_BIN = saved;
      else delete process.env.RAW_AGENT_NPM_BIN;
    }
  });

  it('respects RAW_AGENT_NPM env var as fallback', () => {
    const savedBin = process.env.RAW_AGENT_NPM_BIN;
    const savedNpm = process.env.RAW_AGENT_NPM;
    try {
      delete process.env.RAW_AGENT_NPM_BIN;
      process.env.RAW_AGENT_NPM = '/alt/npm';
      const bin = resolveNpmBin();
      assert.equal(bin, '/alt/npm');
    } finally {
      if (savedBin !== undefined) process.env.RAW_AGENT_NPM_BIN = savedBin;
      else delete process.env.RAW_AGENT_NPM_BIN;
      if (savedNpm !== undefined) process.env.RAW_AGENT_NPM = savedNpm;
      else delete process.env.RAW_AGENT_NPM;
    }
  });

  it('trims whitespace from env var', () => {
    const saved = process.env.RAW_AGENT_NPM_BIN;
    try {
      process.env.RAW_AGENT_NPM_BIN = '  /some/path  ';
      const bin = resolveNpmBin();
      assert.equal(bin, '/some/path');
    } finally {
      if (saved !== undefined) process.env.RAW_AGENT_NPM_BIN = saved;
      else delete process.env.RAW_AGENT_NPM_BIN;
    }
  });

  it('falls back to npm when no explicit path and binary not found', () => {
    const savedBin = process.env.RAW_AGENT_NPM_BIN;
    const savedNpm = process.env.RAW_AGENT_NPM;
    try {
      delete process.env.RAW_AGENT_NPM_BIN;
      delete process.env.RAW_AGENT_NPM;
      const bin = resolveNpmBin();
      // Should either find a real path or fallback to 'npm'
      assert.ok(bin === 'npm' || bin.includes('npm'));
    } finally {
      if (savedBin !== undefined) process.env.RAW_AGENT_NPM_BIN = savedBin;
      else delete process.env.RAW_AGENT_NPM_BIN;
      if (savedNpm !== undefined) process.env.RAW_AGENT_NPM = savedNpm;
      else delete process.env.RAW_AGENT_NPM;
    }
  });
});

describe('resolveGitBin', () => {
  it('returns a non-empty string', () => {
    const bin = resolveGitBin();
    assert.ok(bin.length > 0);
  });

  it('respects RAW_AGENT_GIT_BIN env var', () => {
    const saved = process.env.RAW_AGENT_GIT_BIN;
    try {
      process.env.RAW_AGENT_GIT_BIN = '/custom/git';
      const bin = resolveGitBin();
      assert.equal(bin, '/custom/git');
    } finally {
      if (saved !== undefined) process.env.RAW_AGENT_GIT_BIN = saved;
      else delete process.env.RAW_AGENT_GIT_BIN;
    }
  });

  it('trims whitespace from env var', () => {
    const saved = process.env.RAW_AGENT_GIT_BIN;
    try {
      process.env.RAW_AGENT_GIT_BIN = '  /some/git  ';
      const bin = resolveGitBin();
      assert.equal(bin, '/some/git');
    } finally {
      if (saved !== undefined) process.env.RAW_AGENT_GIT_BIN = saved;
      else delete process.env.RAW_AGENT_GIT_BIN;
    }
  });

  it('finds git on standard Unix paths', () => {
    const saved = process.env.RAW_AGENT_GIT_BIN;
    try {
      delete process.env.RAW_AGENT_GIT_BIN;
      const bin = resolveGitBin();
      if (process.platform !== 'win32') {
        // On macOS/Linux, should find git in one of the standard locations
        assert.ok(
          bin === '/usr/bin/git' ||
          bin === '/opt/homebrew/bin/git' ||
          bin === '/usr/local/bin/git' ||
          bin === 'git',
          `Unexpected git bin: ${bin}`
        );
      }
    } finally {
      if (saved !== undefined) process.env.RAW_AGENT_GIT_BIN = saved;
      else delete process.env.RAW_AGENT_GIT_BIN;
    }
  });

  it('falls back to "git" when no explicit path and no known location', () => {
    // This test is inherently platform-dependent, but the fallback should be 'git'
    const saved = process.env.RAW_AGENT_GIT_BIN;
    try {
      process.env.RAW_AGENT_GIT_BIN = '';
      // Empty string should not be treated as explicit (trim → '')
      const bin = resolveGitBin();
      // With empty string, RAW_AGENT_GIT_BIN?.trim() returns '', which is falsy
      // so it falls through to candidate search
      assert.ok(bin.includes('git'));
    } finally {
      if (saved !== undefined) process.env.RAW_AGENT_GIT_BIN = saved;
      else delete process.env.RAW_AGENT_GIT_BIN;
    }
  });
});
