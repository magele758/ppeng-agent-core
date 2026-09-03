import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ASK_USER_REPLY_META,
  createInteractionTools
} from '../dist/tools/interaction-tools.js';

test('ask_user / save_user_info / collect_credentials', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'ix-tools-'));
  try {
    const tools = createInteractionTools();
    const ask = tools.find((t) => t.name === 'ask_user');
    const save = tools.find((t) => t.name === 'save_user_info');
    const creds = tools.find((t) => t.name === 'collect_credentials');
    assert.equal(ask.approvalMode, 'always');
    assert.equal(creds.sideEffectLevel, 'system');

    const waiting = await ask.execute(
      { stateDir, session: { id: 's1', metadata: {} } },
      { question: '多少？' }
    );
    assert.equal(waiting.ok, false);
    assert.match(waiting.content, /^等待用户回复/);

    const replied = await ask.execute(
      { stateDir, session: { id: 's1', metadata: { [ASK_USER_REPLY_META]: '42' } } },
      { question: '多少？' }
    );
    assert.equal(replied.ok, true);
    assert.match(replied.content, /用户回复：42/);

    const empty = await save.execute({ stateDir, session: { id: 's1', metadata: {} } }, {
      category: 'fact',
      content: ''
    });
    assert.equal(empty.ok, false);

    const saved = await save.execute({ stateDir, session: { id: 's1', metadata: {} } }, {
      category: 'fact',
      content: '喜欢茶'
    });
    assert.equal(saved.ok, true);
    const facts = JSON.parse(readFileSync(join(stateDir, 'user-info', 's1.json'), 'utf8'));
    assert.equal(facts.length, 1);

    const badName = await creds.execute({ stateDir, session: { id: 's1', metadata: {} } }, {
      name: 'notion-token',
      value: 'secret'
    });
    assert.equal(badName.ok, false);

    const stored = await creds.execute({ stateDir, session: { id: 's1', metadata: {} } }, {
      name: 'NOTION_TOKEN',
      value: 'secret-value'
    });
    assert.equal(stored.ok, true);
    assert.ok(!stored.content.includes('secret-value'));
    const vault = JSON.parse(readFileSync(join(stateDir, 'credentials', 's1.json'), 'utf8'));
    assert.equal(vault[0].value, 'secret-value');
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});
