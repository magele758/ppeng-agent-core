/**
 * Homeiot / HA tool unit tests.
 * Mock mode (HOME_ASSISTANT_MOCK=1) is offline; live path exercises fetch + Bearer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  haListEntitiesTool,
  haGetStateTool,
  homeiotBundle,
} from '../dist/index.js';

function withFetchMock(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push({ url, headers: new Headers(init?.headers ?? {}) });
    const body = handler(url, init) ?? '[]';
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function withEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve(fn()).finally(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

const ctx = { repoRoot: '/tmp', stateDir: '/tmp', agent: { id: 'a' }, session: { id: 's' } };

test('homeiotBundle id / tools / agents', () => {
  assert.equal(homeiotBundle.id, 'homeiot');
  assert.deepEqual(
    homeiotBundle.tools.map((t) => t.name).sort(),
    ['ha_get_state', 'ha_list_entities'],
  );
  assert.deepEqual(
    homeiotBundle.agents.map((a) => a.id),
    ['ha-operator'],
  );
  assert.equal(homeiotBundle.agents[0].domainId, 'homeiot');
  for (const name of ['ha_list_entities', 'ha_get_state']) {
    assert.ok(homeiotBundle.agents[0].allowedTools.includes(name));
  }
});

test('ha_list_entities: missing HOME_ASSISTANT_URL returns ok:false', async () => {
  await withEnv(
    { HOME_ASSISTANT_URL: undefined, HOME_ASSISTANT_TOKEN: 't', HOME_ASSISTANT_MOCK: undefined },
    async () => {
      const r = await haListEntitiesTool.execute(ctx, {});
      assert.equal(r.ok, false);
      assert.match(r.content, /HOME_ASSISTANT_URL/);
    },
  );
});

test('ha_list_entities: missing HOME_ASSISTANT_TOKEN returns ok:false', async () => {
  await withEnv(
    {
      HOME_ASSISTANT_URL: 'http://ha.local:8123',
      HOME_ASSISTANT_TOKEN: undefined,
      HOME_ASSISTANT_MOCK: undefined,
    },
    async () => {
      const r = await haListEntitiesTool.execute(ctx, {});
      assert.equal(r.ok, false);
      assert.match(r.content, /HOME_ASSISTANT_TOKEN/);
    },
  );
});

test('ha_list_entities: MOCK=1 returns light + sensor (no network)', async () => {
  await withEnv(
    { HOME_ASSISTANT_MOCK: '1', HOME_ASSISTANT_URL: undefined, HOME_ASSISTANT_TOKEN: undefined },
    async () => {
      const r = await haListEntitiesTool.execute(ctx, {});
      assert.equal(r.ok, true);
      const parsed = JSON.parse(r.content);
      assert.equal(parsed.length, 2);
      assert.equal(parsed[0].entity_id, 'light.living_room');
      assert.equal(parsed[1].entity_id, 'sensor.living_room_temperature');
      assert.equal(parsed[0].provider, 'mock');
    },
  );
});

test('ha_list_entities: MOCK=1 domain filter', async () => {
  await withEnv({ HOME_ASSISTANT_MOCK: '1' }, async () => {
    const r = await haListEntitiesTool.execute(ctx, { domain: 'sensor' });
    assert.equal(r.ok, true);
    const parsed = JSON.parse(r.content);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].entity_id, 'sensor.living_room_temperature');
  });
});

test('ha_get_state: MOCK=1 returns living room light', async () => {
  await withEnv({ HOME_ASSISTANT_MOCK: '1' }, async () => {
    const r = await haGetStateTool.execute(ctx, { entity_id: 'light.living_room' });
    assert.equal(r.ok, true);
    const parsed = JSON.parse(r.content);
    assert.equal(parsed.state, 'on');
    assert.equal(parsed.attributes.brightness, 180);
  });
});

test('ha_get_state: rejects empty entity_id', async () => {
  await withEnv({ HOME_ASSISTANT_MOCK: '1' }, async () => {
    const r = await haGetStateTool.execute(ctx, { entity_id: '   ' });
    assert.equal(r.ok, false);
    assert.match(r.content, /entity_id is required/);
  });
});

test('ha_list_entities: live path hits /api/states with Bearer', async () => {
  const mock = withFetchMock(() =>
    JSON.stringify([{ entity_id: 'light.x', state: 'off', attributes: {} }]),
  );
  try {
    await withEnv(
      {
        HOME_ASSISTANT_MOCK: undefined,
        HOME_ASSISTANT_URL: 'http://ha.test:8123/',
        HOME_ASSISTANT_TOKEN: 'secret-token',
      },
      async () => {
        const r = await haListEntitiesTool.execute(ctx, {});
        assert.equal(r.ok, true);
      },
    );
    assert.equal(mock.calls[0].url, 'http://ha.test:8123/api/states');
    assert.equal(mock.calls[0].headers.get('authorization'), 'Bearer secret-token');
  } finally {
    mock.restore();
  }
});

test('ha_get_state: live path hits /api/states/<id>', async () => {
  const mock = withFetchMock(() =>
    JSON.stringify({ entity_id: 'sensor.temp', state: '21', attributes: {} }),
  );
  try {
    await withEnv(
      {
        HOME_ASSISTANT_MOCK: undefined,
        HOME_ASSISTANT_URL: 'http://ha.test:8123',
        HOME_ASSISTANT_TOKEN: 'tok',
      },
      async () => {
        await haGetStateTool.execute(ctx, { entity_id: 'sensor.temp' });
      },
    );
    assert.equal(mock.calls[0].url, 'http://ha.test:8123/api/states/sensor.temp');
    assert.equal(mock.calls[0].headers.get('authorization'), 'Bearer tok');
  } finally {
    mock.restore();
  }
});

test('tools are approvalMode never (read-only MVP)', () => {
  assert.equal(haListEntitiesTool.approvalMode, 'never');
  assert.equal(haGetStateTool.approvalMode, 'never');
});
