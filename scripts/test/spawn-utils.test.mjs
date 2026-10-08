import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { envForEphemeralDaemon, sanitizeScriptEnv } from '../spawn-utils.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dotenvConfig = createRequire(import.meta.url).resolve('dotenv/config');
const FAKE_TOKEN = ['host', 'dotenv', 'bearer', 'x1'].join('-');

/**
 * Run `node -r dotenv/config` in a cwd whose `.env` sets the host token — the
 * exact load the daemon does via `import 'dotenv/config'` — and report what
 * the child process ends up seeing.
 */
function envSeenByChild(env, keys) {
  const cwd = mkdtempSync(join(tmpdir(), 'ephemeral-env-'));
  try {
    writeFileSync(
      join(cwd, '.env'),
      [
        `RAW_AGENT_AUTH_TOKEN=${FAKE_TOKEN}`,
        'RAW_AGENT_SELF_HEAL_AUTO_START=1',
        'RAW_AGENT_OAUTH_GITHUB_CLIENT_SECRET=' + ['gh', 'secret'].join('-')
      ].join('\n') + '\n'
    );
    const r = spawnSync(
      process.execPath,
      ['-r', dotenvConfig, '-e', `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map((k) => [k, process.env[k] ?? null]))))`],
      { cwd, env, encoding: 'utf8' }
    );
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

const KEYS = ['RAW_AGENT_AUTH_TOKEN', 'RAW_AGENT_SELF_HEAL_AUTO_START', 'RAW_AGENT_OAUTH_GITHUB_CLIENT_SECRET'];

test('the daemon still loads .env through dotenv/config (keeps the probe below meaningful)', () => {
  const server = readFileSync(join(repoRoot, 'apps/daemon/src/server.ts'), 'utf8');
  assert.match(server, /^import 'dotenv\/config';/m);
});

test('control: a plain sanitized env lets the host .env token back in', () => {
  const env = sanitizeScriptEnv({ PATH: process.env.PATH });
  assert.equal(envSeenByChild(env, KEYS).RAW_AGENT_AUTH_TOKEN, FAKE_TOKEN);
});

test('envForEphemeralDaemon: host .env token / self-heal / oauth never reach the daemon', () => {
  const env = envForEphemeralDaemon({ PATH: process.env.PATH });
  assert.deepEqual(envSeenByChild(env, KEYS), {
    RAW_AGENT_AUTH_TOKEN: null,
    RAW_AGENT_SELF_HEAL_AUTO_START: null,
    RAW_AGENT_OAUTH_GITHUB_CLIENT_SECRET: null
  });
});

test('envForEphemeralDaemon: a token exported in the shell is stripped too', () => {
  const env = envForEphemeralDaemon({ PATH: process.env.PATH, RAW_AGENT_AUTH_TOKEN: FAKE_TOKEN });
  assert.equal(envSeenByChild(env, KEYS).RAW_AGENT_AUTH_TOKEN, null);
});

test('envForEphemeralDaemon: host DOTENV_* knobs cannot redirect the load back to a real file', () => {
  const env = envForEphemeralDaemon({
    PATH: process.env.PATH,
    DOTENV_CONFIG_OVERRIDE: 'true',
    DOTENV_CONFIG_PATH: '/somewhere/.env'
  });
  assert.equal(env.DOTENV_CONFIG_OVERRIDE, undefined);
  assert.notEqual(env.DOTENV_CONFIG_PATH, '/somewhere/.env');
  assert.equal(envSeenByChild(env, KEYS).RAW_AGENT_AUTH_TOKEN, null);
});

test('envForEphemeralDaemon: explicit caller overrides layered on top still win', () => {
  const token = ['e2e', 'random', 'x2'].join('-');
  const env = { ...envForEphemeralDaemon({ PATH: process.env.PATH }), RAW_AGENT_AUTH_TOKEN: token };
  assert.equal(envSeenByChild(env, KEYS).RAW_AGENT_AUTH_TOKEN, token);
});

test('envForEphemeralDaemon: still strips injection vectors and keeps ordinary vars', () => {
  const env = envForEphemeralDaemon({ PATH: '/bin', NODE_OPTIONS: '--require evil', RAW_AGENT_MODEL_PROVIDER: 'heuristic' });
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.PATH, '/bin');
  assert.equal(env.RAW_AGENT_MODEL_PROVIDER, 'heuristic');
});
