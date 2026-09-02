import test from 'node:test';
import assert from 'node:assert/strict';
import {
  botForCanonicalSession,
  parseOpenBotResponse,
  visibleBotRoster
} from './bots.ts';

const bot = {
  id: 'researcher',
  name: 'Researcher',
  title: '资料员',
  description: '',
  agentId: 'researcher',
  canonicalSessionId: 'sess_bot',
  hidden: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
};

test('botForCanonicalSession matches roster by canonicalSessionId', () => {
  assert.equal(botForCanonicalSession([bot], 'sess_bot')?.id, 'researcher');
  assert.equal(botForCanonicalSession([bot], 'other'), undefined);
  assert.equal(botForCanonicalSession([bot], null), undefined);
});

test('visibleBotRoster drops hidden', () => {
  assert.deepEqual(
    visibleBotRoster([bot, { ...bot, id: 'x', hidden: true }]).map((b) => b.id),
    ['researcher']
  );
});

test('parseOpenBotResponse accepts session object or sessionId', () => {
  assert.equal(parseOpenBotResponse({ bot, session: { id: 'sess_bot' } }).sessionId, 'sess_bot');
  assert.equal(parseOpenBotResponse({ bot, sessionId: 'sess_alt' }).sessionId, 'sess_alt');
  assert.throws(() => parseOpenBotResponse({ bot }), /缺少 bot 或 session/);
});
