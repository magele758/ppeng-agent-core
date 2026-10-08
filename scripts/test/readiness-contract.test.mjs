import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { miscRoutes } from '../../apps/daemon/dist/routes/misc.js';
import { SqliteStateStore } from '../../packages/core/dist/storage.js';

test('readiness probes the actual state directory and fails closed for a missing database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'readiness-contract-'));
  try {
    async function call(stateDir, store) {
      let body;
      const response = { statusCode: 0, setHeader() {}, end(text) { body = JSON.parse(text); } };
      const route = miscRoutes({ stateDir, store }, { pkgName: 'test', pkgVersion: 'test' }).find(r => r.pattern === '/api/readiness');
      await route.handler({ response });
      return { status: response.statusCode, body };
    }
    const missingDirectory = await call(join(dir, 'does-not-exist'));
    assert.equal(missingDirectory.status, 400);
    assert.equal(missingDirectory.body.checks.stateDirWritable, false);
    const missingDb = await call(dir);
    assert.equal(missingDb.status, 400);
    assert.equal(missingDb.body.checks.stateDirWritable, true);
    assert.equal(missingDb.body.checks.sqliteReadWrite, false);
    const store = new SqliteStateStore(join(dir, 'runtime.sqlite'));
    try {
      const ready = await call(dir, store);
      assert.equal(ready.status, 200);
      assert.ok(Number.isInteger(ready.body.schemaVersion));
      assert.ok(readdirSync(dir).every(name => name.startsWith('runtime.sqlite')));
    } finally { store.db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
