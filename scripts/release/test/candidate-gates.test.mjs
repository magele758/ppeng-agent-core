import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { runG0, runG1, runG3 } from '../gates.mjs';
import { beginCandidateDeployment, createEmptyReport, setGate, saveReport, reportPaths } from '../report-builder.mjs';
import { sanitizeScriptEnv } from '../../spawn-utils.mjs';

async function server(t, responder) {
  const app = createServer(responder);
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { app.closeAllConnections(); app.close(resolve); }));
  return `http://127.0.0.1:${app.address().port}`;
}

test('G1 evaluates the candidate URL, never an ephemeral daemon', async t => {
  const candidateDaemonUrl = await server(t, (req, res) => {
    res.end(JSON.stringify(req.url === '/api/health' ? { ok: true } : { ready: true }));
  });
  let command;
  const report = { gates: {} };
  const result = await runG1({ candidateDaemonUrl, repoRoot: process.cwd() }, report, async (...args) => {
    command = args;
    return { code: 0 };
  });
  assert.equal(result.ok, true);
  assert.deepEqual(command[1], ['scripts/agent-eval/runner.mjs', '--suite', 'candidate', '--base-url', candidateDaemonUrl, '--exit-on-fail']);
});

test('G1 rejects a HTTP 200 readiness=false without executing eval', async t => {
  const candidateDaemonUrl = await server(t, (req, res) => res.end(JSON.stringify(
    req.url === '/api/health' ? { ok: true } : { ready: false }
  )));
  const result = await runG1({ candidateDaemonUrl }, { gates: {} }, () => { throw new Error('must not run'); });
  assert.equal(result.ok, false);
});

test('candidate runner sends auth to the real target and fails semantic readiness', async t => {
  const requests = [];
  let ready = true;
  const base = await server(t, (req, res) => {
    requests.push(req.url);
    if (req.headers.authorization !== 'Bearer test-candidate-token') { res.writeHead(401); res.end('{}'); return; }
    res.end(JSON.stringify(req.url === '/api/health' ? { ok: true } : req.url === '/api/readiness' ? { ready } : { sessions: [] }));
  });
  const out = mkdtempSync(join(tmpdir(), 'candidate-eval-test-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  async function run(extra = ['--suite', 'candidate']) {
    return new Promise(resolve => {
      const child = spawn(process.execPath, ['scripts/agent-eval/runner.mjs', '--base-url', base, '--exit-on-fail', '--out', out, ...extra], {
        env: sanitizeScriptEnv({ ...process.env, RAW_AGENT_AUTH_TOKEN: 'test-candidate-token' }), stdio: 'pipe'
      });
      let log = '';
      child.stdout.on('data', d => { log += d; });
      child.stderr.on('data', d => { log += d; });
      child.on('error', e => resolve({ code: 1, log: e.message }));
      child.on('exit', code => resolve({ code, log }));
    });
  }
  const good = await run();
  assert.equal(good.code, 0, good.log);
  assert.ok(requests.includes('/api/sessions'));
  assert.doesNotMatch(good.log, /spawning daemon/);
  ready = false;
  assert.equal((await run()).code, 1);
  requests.length = 0;
  const unsafe = await run(['--mode', 'fast']);
  assert.equal(unsafe.code, 1);
  assert.match(unsafe.log, /remoteSafe/);
  assert.equal(requests.length, 0);
});

test('G3 cannot promote missing, skipped or failed gates, mutable images or invalid bake timestamps', () => {
  const report = () => greenReport();
  assert.equal(runG3({ bakeHours: 24 }, report()).ok, true);
  for (const key of ['g0', 'g1', 'g2']) for (const value of [undefined, 'skip', 'fail']) {
    const r = report(); r.gates[key] = value;
    assert.equal(runG3({ bakeHours: 24 }, r).ok, false);
  }
  const mutable = report(); mutable.candidate.image_tags.daemon = 'latest';
  assert.equal(runG3({ bakeHours: 24 }, mutable).ok, false);
  const invalid = report(); invalid.observation.bake_started_at = 'bad';
  assert.equal(runG3({ bakeHours: 24 }, invalid).ok, false);
});

function greenReport() {
  const report = createEmptyReport('rel_redeploy');
  beginCandidateDeployment(report, { gitSha: 'abc123', tags: { daemon: 'rel-daemon', web: 'rel-web' } });
  report.candidate.image_ids = { daemon: `sha256:${'a'.repeat(64)}`, web: `sha256:${'b'.repeat(64)}` };
  for (const key of ['g0', 'g1', 'g2']) setGate(report, key, 'pass', 'fixture');
  report.observation.bake_started_at = new Date(Date.now() - 48 * 3600000).toISOString();
  return report;
}

test('redeploying a green run invalidates gates before new artifacts arrive, including identical-image retries', () => {
  const report = greenReport();
  assert.equal(runG3({ backend: 'compose', bakeHours: 24 }, report).ok, true);
  const old = structuredClone(report);
  beginCandidateDeployment(report, { gitSha: 'new-sha', tags: old.candidate.image_tags });
  assert.equal(report.candidate.git_sha, 'new-sha');
  assert.equal(report.candidate.image_ids, undefined);
  assert.equal(report.observation.bake_started_at, '');
  assert.deepEqual(report.gates, { g0: 'pending', g1: 'pending', g2: 'pending', g3: 'pending' });
  // Even an unchanged image pair cannot inherit gates/bake from the prior deployment.
  report.candidate.image_ids = old.candidate.image_ids;
  assert.equal(runG3({ backend: 'compose', bakeHours: 0 }, report).ok, false);
  report.gates = old.gates;
  report.gate_evidence = old.gate_evidence;
  report.observation = old.observation;
  assert.equal(runG3({ backend: 'compose', bakeHours: 0 }, report).ok, false);
});

test('G3 binds successful probes to the exact candidate pair and rejects legacy unbound reports', () => {
  const report = greenReport();
  report.candidate.image_ids.daemon = `sha256:${'c'.repeat(64)}`;
  assert.equal(runG3({ backend: 'compose', bakeHours: 0 }, report).ok, false);
  const legacy = greenReport(); delete legacy.gate_evidence;
  assert.equal(runG3({ backend: 'compose', bakeHours: 0 }, legacy).ok, false);
});

test('G0 refuses to certify a candidate while the checkout points at different source', async () => {
  const report = greenReport();
  const result = await runG0(process.cwd(), report);
  assert.equal(result.ok, false);
  assert.match(result.failures.join(';'), /source revision/);
  assert.equal(report.gates.g0, 'fail');
  assert.equal(report.gate_evidence.g0, null);
});

test('deploy-candidate CLI persists invalidation and source SHA before a failed deployment', {
  skip: process.platform === 'win32' ? 'POSIX command stub' : false
}, () => {
  const bin = mkdtempSync(join(tmpdir(), 'release-deploy-stub-'));
  const id = `rel_test_${randomUUID()}`;
  const paths = reportPaths(process.cwd(), id);
  try {
    writeFileSync(join(bin, 'docker'), '#!/bin/sh\necho intentional-deploy-failure >&2\nexit 1\n');
    chmodSync(join(bin, 'docker'), 0o755);
    const old = greenReport(); old.release_run_id = id;
    saveReport(process.cwd(), old);
    const child = spawnSync(process.execPath, ['scripts/release-orchestrator.mjs', 'deploy-candidate', '--run-id', id], {
      env: sanitizeScriptEnv({ ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, EVOLUTION_RELEASE_BACKEND: 'compose' }),
      encoding: 'utf8', timeout: 10_000
    });
    assert.equal(child.status, 1, child.stdout + child.stderr);
    const actual = JSON.parse(readFileSync(paths.json, 'utf8'));
    assert.equal(actual.candidate.deployment_generation, old.candidate.deployment_generation + 1);
    assert.match(actual.candidate.git_sha, /^[a-f0-9]{40}$/);
    assert.equal(actual.candidate.image_ids, undefined);
    assert.equal(actual.observation.bake_started_at, '');
    assert.deepEqual(actual.gates, { g0: 'pending', g1: 'pending', g2: 'pending', g3: 'pending' });
    assert.equal(runG3({ backend: 'compose', bakeHours: 0 }, actual).ok, false);
  } finally {
    rmSync(paths.json, { force: true }); rmSync(paths.md, { force: true });
    rmSync(bin, { recursive: true, force: true });
  }
});
