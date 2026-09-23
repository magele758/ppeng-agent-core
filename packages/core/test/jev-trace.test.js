import test from 'node:test';
import assert from 'node:assert/strict';
import { askJev, runWithJevTrace } from '../src/jev/client.ts';

const chain = {
  baseUrl: 'http://laya.test',
  apiKey: '',
  model: 'jev-latest',
  points: ['skillSelect'],
  modules: {
    goalGate: false,
    toolGate: false,
    compact: false,
    route: false,
    contextSelect: false,
    toolSelect: false,
    skillSelect: true,
    sagaGate: false,
    memorySelect: false,
    recoveryChoice: false,
    preTurn: false,
    ptcDecide: false
  }
};

test('askJev emits jev_call with the insertion point and scores', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { result: { answers: { s0: { noul: 0.61 } } } };
    }
  });
  const events = [];
  try {
    const answers = await runWithJevTrace(
      {
        sessionId: 'sess',
        emit: (event) => events.push(event)
      },
      () =>
        askJev({
          chain,
          point: 'skillSelect',
          state: 'query',
          nouls: [{ id: 's0', instructions: '当前任务是否需要这个技能？' }]
        })
    );
    assert.equal(answers.s0.noul, 0.61);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'jev_call');
  assert.equal(events[0].payload.point, 'skillSelect');
  assert.equal(events[0].payload.ok, true);
  assert.equal(events[0].payload.answers.s0.noul, 0.61);
  assert.equal(events[0].payload.questions[0].type, 'noul');
  assert.equal(typeof events[0].payload.startedAt, 'string');
  assert.equal(typeof events[0].payload.endedAt, 'string');
});

test('a failed Jev call inside a session still emits jev_call', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 503,
    async json() {
      return {};
    }
  });
  const events = [];
  try {
    const answers = await runWithJevTrace(
      {
        sessionId: 'sess',
        emit: (event) => events.push(event)
      },
      () =>
        askJev({
          chain,
          point: 'compact',
          state: 'x',
          nouls: [{ id: 'k0', instructions: 'keep?' }]
        })
    );
    assert.equal(answers, null);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.point, 'compact');
  assert.equal(events[0].payload.ok, false);
  assert.equal(events[0].payload.error, 'HTTP 503');
});

test('askJev outside a session does not throw when the call fails', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('down');
  };
  try {
    const answers = await askJev({
      chain,
      point: 'compact',
      state: 'x',
      nouls: [{ id: 'k0', instructions: 'keep?' }]
    });
    assert.equal(answers, null);
  } finally {
    globalThis.fetch = original;
  }
});
