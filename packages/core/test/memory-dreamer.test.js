import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStateStore } from '../dist/storage.js';
import {
  clearDreamThrottleForTest,
  dreamNowForUser
} from '../dist/memory/memory-dreamer.js';
import { collectToolsUsed, lastUserTextFromMessages } from '../dist/memory/memory-turn-end.js';

test('dreamNowForUser skip / no_user / force journal', async () => {
  clearDreamThrottleForTest();
  const dir = mkdtempSync(join(tmpdir(), 'dream-'));
  const sqlite = new SqliteStateStore(join(dir, 's.db'));
  try {
    const store = sqlite.agentMemory();
    const settingsOff = {
      getDaemonControl: () => ({ dreamerEnabled: false, curatorMode: 'off' })
    };
    assert.equal(
      await dreamNowForUser({ store, userId: 'u1', settingsStore: settingsOff }),
      'skipped'
    );
    assert.equal(await dreamNowForUser({ store, userId: '' }), 'no_user');

    const result = await dreamNowForUser({
      store,
      userId: 'u1',
      force: true,
      stateDir: dir,
      messagesText: 'user: remember I like tea\nassistant: ok'
    });
    assert.ok(result === 'processed' || result === 'skipped');
    if (result === 'processed') {
      const day = new Date().toISOString().slice(0, 10);
      assert.equal(existsSync(join(dir, 'memory-journals', 'u1', `${day}.md`)), true);
    }
  } finally {
    sqlite.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('lastUserTextFromMessages and collectToolsUsed', () => {
  const text = lastUserTextFromMessages([
    { role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    { role: 'assistant', parts: [{ type: 'text', text: 'hi' }] },
    { role: 'user', parts: [{ type: 'text', text: 'real question' }] }
  ]);
  assert.equal(text, 'real question');
  assert.deepEqual(
    collectToolsUsed([
      {
        role: 'assistant',
        parts: [
          { type: 'tool_call', toolCallId: '1', name: 'echo', input: {} },
          { type: 'tool_call', toolCallId: '2', name: 'echo', input: {} },
          { type: 'tool_call', toolCallId: '3', name: 'read_file', input: {} }
        ]
      }
    ]).sort(),
    ['echo', 'read_file']
  );
});
