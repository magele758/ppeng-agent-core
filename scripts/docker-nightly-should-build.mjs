#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/**
 * Decide whether docker-nightly should rebuild.
 *
 * Skip only when both daemon and web nightly images already carry
 * org.opencontainers.image.revision equal to the current git SHA.
 * First publish, missing labels, or a newer commit → build.
 *
 * Env (CLI):
 *   DOCKER_NIGHTLY_SHA
 *   DOCKER_NIGHTLY_DAEMON_REV
 *   DOCKER_NIGHTLY_WEB_REV
 *   DOCKER_NIGHTLY_FORCE   ("true" to ignore SHA match)
 *
 * Prints GitHub Actions output lines: should_build=... and reason=...
 */

export function normalizeRev(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '<no value>' || raw === '<nil>' || raw === 'null') return '';
  return raw;
}

export function decideDockerNightly({ currentSha, daemonRev, webRev, force }) {
  const sha = String(currentSha ?? '').trim();
  if (!sha) {
    return { shouldBuild: true, reason: 'missing-sha' };
  }
  if (force === true || force === 'true' || force === '1') {
    return { shouldBuild: true, reason: 'force' };
  }
  const daemon = normalizeRev(daemonRev);
  const web = normalizeRev(webRev);
  if (!daemon || !web) {
    return { shouldBuild: true, reason: 'missing-image' };
  }
  if (daemon !== sha || web !== sha) {
    return { shouldBuild: true, reason: 'sha-mismatch' };
  }
  return { shouldBuild: false, reason: 'same-sha' };
}

function runSelfTest() {
  const sha = 'abc123def';
  const cases = [
    {
      name: 'same sha skips',
      input: { currentSha: sha, daemonRev: sha, webRev: sha, force: false },
      want: { shouldBuild: false, reason: 'same-sha' },
    },
    {
      name: 'force rebuilds even when same',
      input: { currentSha: sha, daemonRev: sha, webRev: sha, force: true },
      want: { shouldBuild: true, reason: 'force' },
    },
    {
      name: 'missing daemon rebuilds',
      input: { currentSha: sha, daemonRev: '', webRev: sha, force: false },
      want: { shouldBuild: true, reason: 'missing-image' },
    },
    {
      name: 'missing web rebuilds',
      input: { currentSha: sha, daemonRev: sha, webRev: '<no value>', force: false },
      want: { shouldBuild: true, reason: 'missing-image' },
    },
    {
      name: 'stale daemon rebuilds',
      input: { currentSha: sha, daemonRev: 'old', webRev: sha, force: false },
      want: { shouldBuild: true, reason: 'sha-mismatch' },
    },
    {
      name: 'stale web rebuilds',
      input: { currentSha: sha, daemonRev: sha, webRev: 'old', force: false },
      want: { shouldBuild: true, reason: 'sha-mismatch' },
    },
    {
      name: 'empty sha still builds',
      input: { currentSha: '', daemonRev: '', webRev: '', force: false },
      want: { shouldBuild: true, reason: 'missing-sha' },
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const got = decideDockerNightly(c.input);
    const ok = got.shouldBuild === c.want.shouldBuild && got.reason === c.want.reason;
    if (!ok) {
      failed += 1;
      console.error(`FAIL ${c.name}: got ${JSON.stringify(got)} want ${JSON.stringify(c.want)}`);
    }
  }
  if (failed) {
    process.exit(1);
  }
  console.log(`ok ${cases.length} docker-nightly decide cases`);
}

function emitGithubOutput(decision) {
  const shouldBuild = decision.shouldBuild ? 'true' : 'false';
  process.stdout.write(`should_build=${shouldBuild}\n`);
  process.stdout.write(`reason=${decision.reason}\n`);
}

function main(argv) {
  if (argv.includes('--self-test')) {
    runSelfTest();
    return;
  }
  const decision = decideDockerNightly({
    currentSha: process.env.DOCKER_NIGHTLY_SHA,
    daemonRev: process.env.DOCKER_NIGHTLY_DAEMON_REV,
    webRev: process.env.DOCKER_NIGHTLY_WEB_REV,
    force: process.env.DOCKER_NIGHTLY_FORCE,
  });
  emitGithubOutput(decision);
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  main(process.argv.slice(2));
}
