import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { promoteWithRollback } from '../promotion-policy.mjs';
import * as compose from '../deploy-backend-compose.mjs';
import * as helm from '../deploy-backend-helm.mjs';
import { promoteWithSmoke } from '../deploy-smoke-step.mjs';
import { createEmptyReport } from '../report-builder.mjs';

const image = digit => `sha256:${digit.repeat(64)}`;
const candidateImages = { daemon: image('a'), web: image('b') };
const previousImages = { daemon: image('c'), web: image('d') };

test('promotion policy restores old images after candidate failure and verifies rollback', async () => {
  const activations = [];
  const result = await promoteWithRollback({ candidateImages, previousImages, stableSchema: 21, candidateSchema: 21,
    activate: async images => { activations.push(images); return { ok: images === previousImages }; }, probe: async () => true });
  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, true);
  assert.deepEqual(activations, [candidateImages, previousImages]);
});

test('post-promotion health failure triggers rollback; rollback failure is never reported as recovered', async () => {
  let probes = 0;
  const result = await promoteWithRollback({ candidateImages, previousImages, stableSchema: 21, candidateSchema: 21,
    activate: async () => ({ ok: true }), probe: async () => ++probes > 1 });
  assert.equal(result.rolledBack, true);
  const failed = await promoteWithRollback({ candidateImages, previousImages, stableSchema: 21, candidateSchema: 21,
    activate: async () => ({ ok: false }), probe: async () => { throw new Error('must not probe failed activation'); } });
  assert.equal(failed.ok, false); assert.equal(failed.rolledBack, false);
});

test('schema changes and missing artifact identity require explicit migration handling, without any mutation', async () => {
  for (const patch of [{ candidateSchema: 22 }, { stableSchema: undefined }, { candidateImages: { daemon: 'latest', web: 'latest' } }, { previousImages: null }]) {
    const result = await promoteWithRollback({ candidateImages, previousImages, stableSchema: 21, candidateSchema: 21,
      ...patch, activate: () => { throw new Error('must not mutate'); }, probe: () => false });
    assert.equal(result.ok, false); assert.equal(result.rolledBack, false);
  }
});

function composeFixture({ failActivation = false, postProbeFailure = false, schemaChanged = false, wrongRestoration = false } = {}) {
  const calls = [], overrides = [];
  let activated = 0, probed = 0;
  const services = { daemon: '11', web: '22', 'daemon-candidate': '33', 'web-candidate': '44' };
  const images = { '11': previousImages.daemon, '22': previousImages.web, '33': candidateImages.daemon, '44': candidateImages.web };
  const cfg = { composeDir: '/fixture/compose', composeProject: 'fixture', stableWebUrl: 'http://stable.invalid',
    executeCommand(command, args, options) {
      calls.push({ command, args, options });
      assert.equal(options.env.NODE_OPTIONS, undefined);
      if (args[0] === 'compose' && args.includes('ps')) return { status: 0, stdout: services[args.at(-1)] };
      if (args[0] === 'inspect') return { status: 0, stdout: images[args.at(-1)] };
      if (args[0] === 'exec') return { status: 0, stdout: schemaChanged && args[1] === '33' ? '22' : '21' };
      if (args.includes('up')) {
        activated++;
        const fileIndexes = args.flatMap((arg, i) => arg === '-f' ? [i + 1] : []);
        const override = JSON.parse(readFileSync(args[fileIndexes[1]], 'utf8'));
        overrides.push(override);
        if (!(failActivation && activated === 1) && !(wrongRestoration && activated > 1)) {
          images['11'] = override.services.daemon.image;
          images['22'] = override.services.web.image;
        }
        return { status: failActivation && activated === 1 ? 1 : 0, stderr: 'fixture activation' };
      }
      return { status: 0, stdout: '' };
    },
    probeStable: async () => !(postProbeFailure && ++probed === 1)
  };
  return { cfg, calls, overrides, images };
}

test('two Compose promotions: outer smoke failure restores exact IDs from the first promotion', async () => {
  const { cfg, overrides, images } = composeFixture();
  cfg.stableDaemonUrl = 'http://stable.invalid';
  assert.equal((await compose.promoteStable(cfg, { imageIds: candidateImages })).ok, true);
  const nextImages = { daemon: image('e'), web: image('f') };
  images['33'] = nextImages.daemon; images['44'] = nextImages.web;
  const report = createEmptyReport('rel_two_promotions');
  let smokes = 0;
  const result = await promoteWithSmoke({ cfg, report, backend: compose, tags: { imageIds: nextImages }, log: () => {},
    smoke: async () => ({ ok: ++smokes > 1, counts: {}, checks: [], failedChecks: smokes === 1 ? ['sse_stream'] : [] }) });
  assert.equal(result.ok, false);
  assert.equal(report.outcome, 'rolled_back');
  assert.equal(report.rollback.ok, true);
  assert.equal(smokes, 2, 'the restored stable must pass the same smoke');
  assert.deepEqual(report.stable.previous.imageIds, candidateImages);
  assert.equal(overrides.at(-1).services.daemon.image, candidateImages.daemon);
  assert.equal(overrides.at(-1).services.web.image, candidateImages.web);
});

test('Compose refuses to claim rollback when actual restored IDs do not match', async () => {
  const { cfg } = composeFixture({ postProbeFailure: true, wrongRestoration: true });
  const result = await compose.promoteStable(cfg, { imageIds: candidateImages });
  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, false);
});

test('Compose promotes exact IDs without rebuild; failed post-probe restores the previous pinned images', async () => {
  const { cfg, calls, overrides } = composeFixture({ postProbeFailure: true });
  const result = await compose.promoteStable(cfg, { imageIds: candidateImages });
  assert.equal(result.ok, false); assert.equal(result.rolledBack, true);
  assert.deepEqual(overrides.map(o => [o.services.daemon.image, o.services.web.image]), [
    [candidateImages.daemon, candidateImages.web], [previousImages.daemon, previousImages.web]
  ]);
  for (const { args } of calls.filter(c => c.args.includes('up'))) {
    assert.ok(args.includes('--no-build')); assert.ok(args.includes('--wait')); assert.ok(!args.includes('--build'));
  }
  assert.ok(calls.every(c => !c.args.includes('down') && !c.args.includes('--remove-orphans')));
});

test('Compose refuses changed candidate IDs or schema changes before changing stable', async () => {
  for (const schemaChanged of [false, true]) {
    const { cfg, calls } = composeFixture({ schemaChanged });
    const result = await compose.promoteStable(cfg, { imageIds: schemaChanged ? candidateImages : previousImages });
    assert.equal(result.ok, false);
    assert.ok(calls.every(c => !c.args.includes('up')));
  }
});

test('candidate teardown targets only candidate services, not project down or stable containers', () => {
  const { cfg, calls } = composeFixture();
  assert.equal(compose.rollbackCandidate(cfg).ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args.slice(-3), ['stop', 'web-candidate', 'daemon-candidate']);
  assert.deepEqual(calls[1].args.slice(-4), ['rm', '-f', 'web-candidate', 'daemon-candidate']);
});

function helmFixture({ mutablePrevious = false, wrongRestoration = false, wrongPromotion = false } = {}) {
  const calls = [];
  const qualified = images => Object.fromEntries(Object.entries(images).map(([role, id]) => [role, `registry.invalid/${role}@${id}`]));
  const candidate = qualified(candidateImages), previous = qualified(previousImages);
  let running = previous;
  let stableProbes = 0;
  const cfg = { repoRoot: '/fixture', helmNamespace: 'fixture', helmChart: '/fixture/chart', helmReleaseCandidate: 'candidate', helmReleaseStable: 'stable',
    stableWebUrl: 'http://stable.invalid', candidateDaemonUrl: 'http://candidate.invalid',
    executeCommand(command, args) {
      calls.push({ command, args });
      if (command === 'kubectl') {
        const images = args.includes('app.kubernetes.io/instance=candidate') ? candidate : running;
        return { status: 0, stdout: JSON.stringify({ items: [{ status: { containerStatuses: Object.entries(images).map(([name, imageID]) => ({ name, imageID, ready: true })) } }] }) };
      }
      if (args[0] === 'status') return { status: 0, stdout: JSON.stringify({ version: 3, info: { status: 'deployed' } }) };
      if (args[0] === 'get' && args[1] === 'manifest') return { status: 0, stdout: Object.entries(previous).map(([name, image]) =>
        JSON.stringify({ kind: 'Deployment', spec: { template: { spec: { containers: [{ name, image: mutablePrevious ? `registry.invalid/${name}:latest` : image }] } } } })
      ).join('\n---\n') };
      if (args[0] === 'upgrade') running = wrongPromotion ? previous : candidate;
      if (args[0] === 'rollback') running = wrongRestoration ? candidate : previous;
      return { status: 0, stdout: 'ok' };
    },
    async fetchJson(url) {
      if (url.endsWith('/sessions')) return { ok: true, data: { sessions: [] } };
      const ready = wrongPromotion || !url.includes('stable.invalid') || ++stableProbes !== 2;
      return { ok: true, data: { ready, schemaVersion: 21 } };
    }
  };
  return { cfg, candidate, previous, calls };
}

test('Helm pins candidate digests and verifies prior immutable revision on a failed post-probe', async () => {
  const { cfg, candidate, calls } = helmFixture();
  const result = await helm.promoteStable(cfg, { imageRefs: candidate });
  assert.equal(result.ok, false); assert.equal(result.rolledBack, true);
  const upgrade = calls.find(c => c.command === 'helm' && c.args[0] === 'upgrade');
  assert.ok(upgrade.args.includes(`image.daemon.digest=${candidateImages.daemon}`));
  assert.ok(upgrade.args.includes('--atomic'));
  const rollback = calls.find(c => c.command === 'helm' && c.args[0] === 'rollback');
  assert.deepEqual(rollback.args.slice(0, 3), ['rollback', 'stable', '3']);
  assert.ok(calls.every(c => !c.args.includes('uninstall')));
});

test('Helm rejects mutable prior manifests before touching stable even when current Pods look healthy', async () => {
  const { cfg, candidate, calls } = helmFixture({ mutablePrevious: true });
  const result = await helm.promoteStable(cfg, { imageRefs: candidate });
  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, false);
  assert.match(result.detail, /pin stable digests/);
  assert.ok(!calls.some(c => ['upgrade', 'rollback'].includes(c.args[0])));
});

test('Helm does not report a successful restoration when ready Pods run different digests', async () => {
  const { cfg, candidate } = helmFixture({ wrongRestoration: true });
  const result = await helm.promoteStable(cfg, { imageRefs: candidate });
  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, false);
});

test('Helm verifies actual candidate activation and exposes the same immutable rollback contract to outer smoke', async () => {
  const { cfg, candidate, previous } = helmFixture({ wrongPromotion: true });
  const snapshot = helm.currentStable(cfg);
  assert.deepEqual(snapshot, { revision: 3, imageRefs: previous });
  const result = await helm.promoteStable(cfg, { imageRefs: candidate });
  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, true);
  assert.equal(helm.rollbackStable(cfg, snapshot).ok, true);
});
