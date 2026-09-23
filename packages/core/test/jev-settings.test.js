import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activePoints,
  defaultJevSettings,
  publicJevSettings,
  readJevSettings,
  resolveJevChain,
  writeJevSettings
} from '../src/jev/settings.ts';

function kvStore() {
  const map = new Map();
  return {
    getDaemonControl(key) {
      return map.get(key);
    },
    setDaemonControl(key, value) {
      map.set(key, value);
    }
  };
}

const ALL_OFF = {
  goalGate: false,
  toolGate: false,
  compact: false,
  route: false,
  contextSelect: false,
  toolSelect: false,
  skillSelect: false,
  sagaGate: false,
  memorySelect: false,
  recoveryChoice: false,
  preTurn: false,
  ptcDecide: false
};

test('jev stays off until an entry is saved; profile drives points', () => {
  const store = kvStore();
  assert.equal(defaultJevSettings().enabled, false);
  assert.equal(defaultJevSettings().profile, 'off');
  assert.equal(readJevSettings(store).baseUrl, '');
  assert.equal(resolveJevChain(store, {}), null);
  assert.deepEqual(activePoints(readJevSettings(store)), []);
  assert.equal(publicJevSettings(readJevSettings(store), {}).chained, false);

  writeJevSettings(store, {
    profile: 'max',
    points: { goalGate: true, toolGate: true, compact: true, route: true }
  });
  assert.equal(readJevSettings(store).enabled, false);
  assert.deepEqual(activePoints(readJevSettings(store)), []);
  assert.equal(resolveJevChain(store, { TYPESAFE_API_KEY: 'secret' }), null);

  writeJevSettings(store, { baseUrl: 'https://api.typesafe.ai/v1/' });
  const saved = readJevSettings(store);
  assert.equal(saved.baseUrl, 'https://api.typesafe.ai/v1');
  assert.equal(saved.profile, 'max');
  assert.equal(saved.enabled, true);
  assert.deepEqual(activePoints(saved), ['goalGate', 'toolGate', 'compact', 'route']);
  const chain = resolveJevChain(store, { TYPESAFE_API_KEY: 'secret' });
  assert.equal(chain.baseUrl, 'https://api.typesafe.ai/v1');
  assert.equal(chain.apiKey, 'secret');
  assert.deepEqual(chain.points, ['goalGate', 'toolGate', 'compact', 'route']);
  assert.equal(chain.modules.route, true);

  writeJevSettings(store, { profile: 'off' });
  assert.equal(resolveJevChain(store, {}), null);
  assert.deepEqual(activePoints(readJevSettings(store)), []);
  const pub = publicJevSettings(readJevSettings(store), {});
  assert.equal(pub.configured, true);
  assert.equal(pub.chained, false);
  assert.equal(pub.active.toolGate, false);
});

test('activePoints: no entry always empty even for max', () => {
  assert.deepEqual(
    activePoints({
      baseUrl: '',
      profile: 'max',
      points: { ...ALL_OFF, goalGate: true, toolGate: true, compact: true, route: true }
    }),
    []
  );
});

test('activePoints: normal only goalGate; mini and off empty', () => {
  const base = {
    baseUrl: 'https://api.typesafe.ai/v1',
    points: { ...ALL_OFF, goalGate: true, toolGate: true, compact: true, route: true }
  };
  assert.deepEqual(activePoints({ ...base, profile: 'normal' }), ['goalGate']);
  assert.deepEqual(activePoints({ ...base, profile: 'mini' }), []);
  assert.deepEqual(activePoints({ ...base, profile: 'off' }), []);
  assert.deepEqual(activePoints({ ...base, profile: 'full' }), ['goalGate', 'toolGate']);
  assert.deepEqual(activePoints({ ...base, profile: 'max' }), [
    'goalGate',
    'toolGate',
    'compact',
    'route'
  ]);
});

test('activePoints: max never includes new custom-only points', () => {
  const points = activePoints({
    baseUrl: 'https://api.typesafe.ai/v1',
    profile: 'max',
    points: {
      ...ALL_OFF,
      goalGate: true,
      toolGate: true,
      compact: true,
      route: true,
      contextSelect: true,
      toolSelect: true,
      skillSelect: true,
      sagaGate: true,
      memorySelect: true,
      recoveryChoice: true,
      preTurn: true,
      ptcDecide: true
    }
  });
  assert.deepEqual(points, ['goalGate', 'toolGate', 'compact', 'route']);
  assert.ok(!points.includes('contextSelect'));
  assert.ok(!points.includes('preTurn'));
  assert.ok(!points.includes('toolSelect'));
  assert.ok(!points.includes('skillSelect'));
  assert.ok(!points.includes('memorySelect'));
  assert.ok(!points.includes('recoveryChoice'));
  assert.ok(!points.includes('sagaGate'));
  assert.ok(!points.includes('ptcDecide'));
});

test('activePoints: custom uses only user points; presets ignore checkboxes', () => {
  const entry = 'https://api.typesafe.ai/v1';
  assert.deepEqual(
    activePoints({
      baseUrl: entry,
      profile: 'custom',
      points: { ...ALL_OFF, toolGate: true, route: true }
    }),
    ['toolGate', 'route']
  );
  assert.deepEqual(
    activePoints({
      baseUrl: entry,
      profile: 'custom',
      points: { ...ALL_OFF, contextSelect: true, preTurn: true, memorySelect: true, ptcDecide: true }
    }),
    ['contextSelect', 'memorySelect', 'preTurn', 'ptcDecide']
  );
  assert.deepEqual(
    activePoints({
      baseUrl: entry,
      profile: 'normal',
      points: { ...ALL_OFF, toolGate: true, compact: true, route: true, contextSelect: true, ptcDecide: true }
    }),
    ['goalGate']
  );
});

test('activePoints: ptcDecide only when custom + checked + baseUrl', () => {
  assert.deepEqual(
    activePoints({
      baseUrl: '',
      profile: 'custom',
      points: { ...ALL_OFF, ptcDecide: true }
    }),
    []
  );
  assert.deepEqual(
    activePoints({
      baseUrl: 'https://api.typesafe.ai/v1',
      profile: 'custom',
      points: { ...ALL_OFF, ptcDecide: true }
    }),
    ['ptcDecide']
  );
  assert.ok(
    !activePoints({
      baseUrl: 'https://api.typesafe.ai/v1',
      profile: 'max',
      points: { ...ALL_OFF, ptcDecide: true }
    }).includes('ptcDecide')
  );
});

test('activePoints: off with entry still empty', () => {
  assert.deepEqual(
    activePoints({
      baseUrl: 'https://api.typesafe.ai/v1',
      profile: 'off',
      points: { ...ALL_OFF, goalGate: true, contextSelect: true, preTurn: true }
    }),
    []
  );
});

test('PATCH can update only profile or only custom points', () => {
  const store = kvStore();
  writeJevSettings(store, {
    baseUrl: 'https://api.typesafe.ai/v1',
    profile: 'custom',
    points: { ...ALL_OFF, goalGate: true }
  });
  writeJevSettings(store, { points: { compact: true } });
  let s = readJevSettings(store);
  assert.equal(s.profile, 'custom');
  assert.equal(s.points.goalGate, true);
  assert.equal(s.points.compact, true);
  assert.deepEqual(activePoints(s), ['goalGate', 'compact']);

  writeJevSettings(store, { profile: 'full' });
  s = readJevSettings(store);
  assert.equal(s.profile, 'full');
  assert.deepEqual(activePoints(s), ['goalGate', 'toolGate']);
  // custom checkboxes preserved for later
  assert.equal(s.points.compact, true);
});

test('PATCH preserves apiKey when omitted; public view never returns raw key', () => {
  const store = kvStore();
  writeJevSettings(store, {
    baseUrl: 'https://api.typesafe.ai/v1',
    apiKey: 'sk-secret',
    profile: 'normal'
  });
  writeJevSettings(store, { model: 'jev-v2', points: { goalGate: true } });
  const saved = readJevSettings(store);
  assert.equal(saved.apiKey, 'sk-secret');
  assert.equal(saved.model, 'jev-v2');
  const pub = publicJevSettings(saved, {});
  assert.equal(pub.apiKeySet, true);
  assert.equal(Object.prototype.hasOwnProperty.call(pub, 'apiKey'), false);
  assert.equal(typeof pub.apiKey, 'undefined');

  writeJevSettings(store, { clearApiKey: true });
  assert.equal(readJevSettings(store).apiKey, '');
  assert.equal(publicJevSettings(readJevSettings(store), {}).apiKeySet, false);
});

test('legacy enabled+modules migrates to custom', () => {
  const store = kvStore();
  store.setDaemonControl('jev_settings', {
    baseUrl: 'https://api.typesafe.ai/v1',
    enabled: true,
    modules: { goalGate: true, toolGate: true, compact: false },
    model: 'jev-latest',
    apiKey: '',
    updatedAt: new Date().toISOString()
  });
  const s = readJevSettings(store);
  assert.equal(s.profile, 'custom');
  assert.deepEqual(activePoints(s), ['goalGate', 'toolGate']);
  assert.equal(s.points.route, false);
  assert.equal(s.points.contextSelect, false);
});
