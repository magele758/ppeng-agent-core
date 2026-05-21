#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

function runGit(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { code: r.status ?? 1, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() };
}

export function gitSync({ repoRoot, remote = 'origin', branch = 'main', pull = true }) {
  const fetch = runGit(['fetch', remote, branch], repoRoot);
  if (fetch.code !== 0) {
    return { ok: false, step: 'fetch', detail: fetch.stderr || fetch.stdout };
  }
  if (!pull) {
    return { ok: true, sha: runGit(['rev-parse', 'HEAD'], repoRoot).stdout };
  }
  const pullRes = runGit(['pull', '--rebase', remote, branch], repoRoot);
  if (pullRes.code !== 0) {
    return { ok: false, step: 'pull', detail: pullRes.stderr || pullRes.stdout };
  }
  const sha = runGit(['rev-parse', 'HEAD'], repoRoot).stdout;
  return { ok: true, sha };
}

export function currentGitSha(repoRoot) {
  return runGit(['rev-parse', 'HEAD'], repoRoot).stdout;
}
