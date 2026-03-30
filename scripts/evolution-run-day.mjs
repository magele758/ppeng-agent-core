#!/usr/bin/env node
/**
 * 读取 doc/evolution/inbox 最新 md，对每条候选创建 git worktree、npm ci、跑测试；
 * 写 doc/evolution/success 或 failure；可选合并到主分支（默认关闭）。
 *
 * 环境变量见 .env.example EVOLUTION_*
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const __dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dir, '..');
loadDotenv({ path: join(repoRoot, '.env') });

function enrichEnv() {
  const { execPath } = process;
  const sep = process.platform === 'win32' ? ';' : ':';
  const extra = [dirname(execPath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'].join(sep);
  return { ...process.env, PATH: `${extra}${sep}${process.env.PATH || ''}` };
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd ?? repoRoot,
      env: enrichEnv(),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    let err = '';
    child.stdout?.on('data', (c) => {
      out += c.toString();
    });
    child.stderr?.on('data', (c) => {
      err += c.toString();
    });
    child.on('close', (code) => resolve({ code: code ?? 1, out, err }));
    child.on('error', reject);
  });
}

function sh(cmd, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'cmd' : 'sh', process.platform === 'win32' ? ['/c', cmd] : ['-c', cmd], {
      cwd: cwd ?? repoRoot,
      env: enrichEnv(),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    let err = '';
    child.stdout?.on('data', (c) => {
      out += c.toString();
    });
    child.stderr?.on('data', (c) => {
      err += c.toString();
    });
    child.on('close', (code) => resolve({ code: code ?? 1, out, err }));
    child.on('error', reject);
  });
}

function utcDateString(d) {
  return d.toISOString().slice(0, 10);
}

function makeSlug(title, link) {
  const h = createHash('sha256').update(link).digest('hex').slice(0, 8);
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'exp';
  return `${base}-${h}`.replace(/[/\\]/g, '-');
}

function parseInboxItems(text) {
  const items = [];
  const re = /^-\s*\[([^\]]*)\]\(([^)]+)\)/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const title = m[1].trim();
    const link = m[2].trim();
    if (title && link) items.push({ title, link });
  }
  return items;
}

function pickInboxFile() {
  const inboxDir = join(repoRoot, 'doc', 'evolution', 'inbox');
  if (!existsSync(inboxDir)) return null;
  const today = utcDateString(new Date());
  const todayPath = join(inboxDir, `${today}.md`);
  if (existsSync(todayPath)) return todayPath;
  const files = readdirSync(inboxDir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .reverse();
  if (files.length === 0) return null;
  return join(inboxDir, files[0]);
}

function truthy(v) {
  return ['1', 'true', 'yes', 'on'].includes(String(v ?? '').trim().toLowerCase());
}

async function gitClean() {
  const { code, out } = await run('git', ['status', '--porcelain'], { cwd: repoRoot });
  if (code !== 0) return false;
  return out.trim().length === 0;
}

async function writeFailureDoc({ slug, title, link, branch, testCmd, errTail, analysis }) {
  const dir = join(repoRoot, 'doc', 'evolution', 'failure');
  await mkdir(dir, { recursive: true });
  const name = `${utcDateString(new Date())}-${slug}.md`;
  const p = join(dir, name);
  const body = `---
status: failure
source_url: ${JSON.stringify(link)}
source_title: ${JSON.stringify(title)}
experiment_branch: ${JSON.stringify(branch)}
test_command: ${JSON.stringify(testCmd)}
date_utc: ${JSON.stringify(new Date().toISOString())}
---

# 实验失败：${title}

## 来源
- [${title}](${link})

## 分支
\`${branch}\`

## 测试命令
\`${testCmd}\`

## 失败输出（摘录）

\`\`\`
${errTail.slice(0, 16000)}
\`\`\`

## 原因分析

${analysis}
`;
  await writeFile(p, body, 'utf8');
  console.error(`evolution-run-day: wrote ${p}`);
}

async function writeSuccessDoc({ slug, title, link, branch, testCmd, outTail, merged, mergeCommit }) {
  const dir = join(repoRoot, 'doc', 'evolution', 'success');
  await mkdir(dir, { recursive: true });
  const name = `${utcDateString(new Date())}-${slug}.md`;
  const p = join(dir, name);
  const body = `---
status: success
source_url: ${JSON.stringify(link)}
source_title: ${JSON.stringify(title)}
experiment_branch: ${JSON.stringify(branch)}
test_command: ${JSON.stringify(testCmd)}
merged: ${merged}
merge_commit: ${JSON.stringify(mergeCommit || '')}
date_utc: ${JSON.stringify(new Date().toISOString())}
---

# 实验成功：${title}

## 来源
- [${title}](${link})

## 实验分支
\`${branch}\`

## 测试命令
\`${testCmd}\`

## 输出摘要

\`\`\`
${outTail.slice(0, 12000)}
\`\`\`

## 合并

${merged ? `已合并。Commit: ${mergeCommit || '(see git log)'}` : `未自动合并（EVOLUTION_AUTO_MERGE=0）；请在主仓手动 \`git merge ${branch}\``}
`;
  await writeFile(p, body, 'utf8');
  console.log(`evolution-run-day: wrote ${p}`);
}

async function removeWorktree(wtPath) {
  await run('git', ['worktree', 'remove', '--force', wtPath], { cwd: repoRoot }).catch(() => {});
  try {
    await rm(wtPath, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

async function deleteBranch(branch) {
  await run('git', ['branch', '-D', branch], { cwd: repoRoot }).catch(() => {});
}

async function main() {
  const inboxPath = pickInboxFile();
  if (!inboxPath) {
    console.log('evolution-run-day: no inbox file in doc/evolution/inbox — run evolution:learn first');
    return;
  }

  const text = readFileSync(inboxPath, 'utf8');
  let items = parseInboxItems(text);
  const max = Math.max(0, Math.min(10, Number(process.env.EVOLUTION_MAX_ITEMS ?? 3) || 3));
  if (max === 0) {
    console.log('evolution-run-day: EVOLUTION_MAX_ITEMS=0 — skip');
    return;
  }
  items = items.slice(0, max);

  if (items.length === 0) {
    console.log('evolution-run-day: no - [title](url) lines in inbox');
    return;
  }

  const allowDirty = truthy(process.env.EVOLUTION_ALLOW_DIRTY_WORKTREE);
  if (!allowDirty && !(await gitClean())) {
    console.error('evolution-run-day: git working tree is not clean (set EVOLUTION_ALLOW_DIRTY_WORKTREE=1 to override)');
    process.exitCode = 1;
    return;
  }

  const targetBranch = process.env.EVOLUTION_TARGET_BRANCH?.trim() || process.env.RAW_AGENT_SELF_HEAL_TARGET_BRANCH?.trim() || 'main';
  const autoMerge = truthy(process.env.EVOLUTION_AUTO_MERGE);
  const testCmd = process.env.EVOLUTION_TEST_CMD?.trim() || 'npm run test:unit';
  const skipCi = truthy(process.env.EVOLUTION_SKIP_NPM_CI);

  const today = utcDateString(new Date());
  const wtRoot = join(repoRoot, '.evolution-worktrees');
  await mkdir(wtRoot, { recursive: true });

  for (const { title, link } of items) {
    const slug = makeSlug(title, link);
    const branch = `exp/evolution-${today}-${slug}`;
    const wtPath = join(wtRoot, `${today}-${slug}`);

    await removeWorktree(wtPath);
    await deleteBranch(branch);

    const add = await run('git', ['worktree', 'add', '-b', branch, wtPath, targetBranch], { cwd: repoRoot });
    if (add.code !== 0) {
      await writeFailureDoc({
        slug,
        title,
        link,
        branch,
        testCmd,
        errTail: add.out + add.err,
        analysis: 'git worktree add 失败（可能分支已存在或路径占用）。'
      });
      continue;
    }

    let testOut = '';
    let testErr = '';
    let testCode = 1;

    if (!skipCi) {
      const ci = await sh('npm ci', wtPath);
      testOut += ci.out + ci.err;
      if (ci.code !== 0) {
        await removeWorktree(wtPath);
        await writeFailureDoc({
          slug,
          title,
          link,
          branch,
          testCmd: 'npm ci',
          errTail: testOut,
          analysis: 'npm ci 失败（依赖或网络）。可设置 EVOLUTION_SKIP_NPM_CI=1 跳过安装（需自行保证 worktree 可测）。'
        });
        await deleteBranch(branch);
        continue;
      }
    }

    const runTest = await sh(testCmd, wtPath);
    testOut += runTest.out;
    testErr += runTest.err;
    testCode = runTest.code;

    await removeWorktree(wtPath);

    if (testCode !== 0) {
      await writeFailureDoc({
        slug,
        title,
        link,
        branch,
        testCmd,
        errTail: testErr || testOut,
        analysis: '测试命令非零退出。请根据日志判断是测试失败、超时还是环境差异。'
      });
      await deleteBranch(branch);
      continue;
    }

    let merged = false;
    let mergeCommit = '';
    if (autoMerge) {
      const co = await run('git', ['checkout', targetBranch], { cwd: repoRoot });
      if (co.code !== 0) {
        await writeFailureDoc({
          slug,
          title,
          link,
          branch,
          testCmd: `git checkout ${targetBranch}`,
          errTail: co.out + co.err,
          analysis: `测试通过但无法检出 ${targetBranch} 以合并。`
        });
        continue;
      }
      const mg = await run('git', ['merge', '--no-ff', '-m', `evolution: merge ${branch}`, branch], { cwd: repoRoot });
      if (mg.code !== 0) {
        await run('git', ['merge', '--abort'], { cwd: repoRoot }).catch(() => {});
        await writeFailureDoc({
          slug,
          title,
          link,
          branch,
          testCmd: `git merge ${branch}`,
          errTail: mg.out + mg.err,
          analysis: '测试通过但合并到主分支冲突或失败；实验分支仍保留，请手动处理。'
        });
        continue;
      }
      merged = true;
      const rev = await run('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
      mergeCommit = rev.out.trim().slice(0, 40);
      await run('git', ['branch', '-d', branch], { cwd: repoRoot }).catch(() => {});
    } else {
      console.log(`evolution-run-day: branch ${branch} kept for manual merge`);
    }

    await writeSuccessDoc({
      slug,
      title,
      link,
      branch,
      testCmd,
      outTail: testOut,
      merged,
      mergeCommit
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
