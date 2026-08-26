import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExtensionRegistry } from '../dist/extensions/extension-registry.js';
import { runDoctor, formatDoctorReport } from '../dist/doctor/doctor.js';
import {
  assertToolsetInvariant,
  PromptCacheInvariantError,
  resolveToolsetLock,
  TOOLSET_LOCK_META_KEY,
  promptCacheStrictFromEnv
} from '../dist/session/prompt-cache.js';
import {
  applyPermissionModeGate,
  describePermissionMode,
  explainToolUnderMode,
  shiftPermissionMode
} from '../dist/approval/permission-mode.js';

test('ExtensionRegistry: before_turn block wins', async () => {
  const reg = createExtensionRegistry([
    {
      id: 'a',
      handlers: {
        before_turn: () => ({ systemMessage: 'from-a' })
      }
    },
    {
      id: 'b',
      handlers: {
        before_turn: () => ({ block: true, message: 'nope' })
      }
    }
  ]);
  const r = await reg.run('before_turn', { sessionId: 's1' });
  assert.equal(r.block, true);
  assert.match(r.message ?? '', /nope/);
});

test('ExtensionRegistry: after_tool concatenates system messages', async () => {
  const reg = createExtensionRegistry();
  reg.register({
    id: 'log',
    handlers: {
      after_tool: () => ({ systemMessage: 'logged' })
    }
  });
  const r = await reg.run('after_tool', { sessionId: 's1', tool: 'bash', ok: true, content: 'ok' });
  assert.equal(r.systemMessage, 'logged');
});

test('doctor: reports model env fail when unset', () => {
  const root = mkdtempSync(join(tmpdir(), 'doctor-'));
  const report = runDoctor({
    repoRoot: root,
    stateDir: join(root, 'state'),
    env: { ...process.env, RAW_AGENT_BASE_URL: '', RAW_AGENT_API_KEY: '', RAW_AGENT_MODEL_NAME: '' }
  });
  assert.equal(report.ok, false);
  assert.ok(report.checks.some((c) => c.id === 'model_env' && c.severity === 'fail'));
  assert.match(formatDoctorReport(report), /ISSUES/);
});

test('assertToolsetInvariant strict throws on drift', () => {
  const first = resolveToolsetLock('s', ['bash'], {});
  assert.throws(
    () =>
      assertToolsetInvariant(
        's',
        ['bash', 'write_file'],
        { [TOOLSET_LOCK_META_KEY]: first.fingerprint },
        { strict: true }
      ),
    (e) => e instanceof PromptCacheInvariantError
  );
  assert.equal(promptCacheStrictFromEnv({ RAW_AGENT_PROMPT_CACHE_STRICT: '1' }), true);
});

test('permission mode deny includes remediation', () => {
  const g = applyPermissionModeGate('plan', 'bash', 'auto');
  assert.equal(g?.action, 'deny');
  if (g?.action === 'deny') {
    assert.ok(g.code);
    assert.match(g.remediation, /permissionMode/);
  }
  assert.equal(shiftPermissionMode('plan', 'elevate'), 'ask');
  assert.equal(shiftPermissionMode('auto', 'demote'), 'acceptEdits');
  assert.match(describePermissionMode('plan'), /Read-only/i);
  const ex = explainToolUnderMode('plan', 'bash');
  assert.equal(ex.decision, 'deny');
});
