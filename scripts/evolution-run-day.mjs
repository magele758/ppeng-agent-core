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
  // Undo evolution-learn bug: nested .map() arrays were join()ed as comma-separated one-liners
  const normalized = text.replace(/\)\s*,\s*-\s*\[/g, ')\n- [');
  const items = [];
  const re = /^-\s*\[([^\]]*)\]\(([^)]+)\)/gm;
  let m;
  while ((m = re.exec(normalized)) !== null) {
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

const DEFAULT_LINK_FETCH_MS = 25_000;
const MAX_LINK_EXCERPT = 14_000;
const TEST_FAIL_TRACE_CHARS = 2_500;

/** 抓取 inbox 链接的正文（去 HTML），供「完整阅读」对照；失败不阻断后续测试。 */
async function fetchSourceExcerpt(url) {
  const ms = Math.max(3000, Number(process.env.EVOLUTION_LINK_FETCH_MS ?? DEFAULT_LINK_FETCH_MS) || DEFAULT_LINK_FETCH_MS);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'evolution-run-day/0.1 (+https://github.com)' },
      redirect: 'follow'
    });
    clearTimeout(t);
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, excerpt: '' };
    }
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const raw = await res.text();
    if (ct.includes('application/json')) {
      return { ok: true, excerpt: raw.slice(0, MAX_LINK_EXCERPT) };
    }
    const stripped = raw
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { ok: true, excerpt: stripped.slice(0, MAX_LINK_EXCERPT) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, excerpt: '' };
  }
}

function tailForLog(s, max = TEST_FAIL_TRACE_CHARS) {
  if (!s || s.length <= max) return s;
  return `…(截断)…\n${s.slice(-max)}`;
}

/** 有限并发执行 async 任务（默认最多 3 路）。 */
async function runPool(items, limit, worker) {
  const n = items.length;
  if (n === 0) return;
  const cap = Math.max(1, Math.min(limit, n));
  let next = 0;
  const runWorker = async () => {
    while (true) {
      const i = next;
      next += 1;
      if (i >= n) return;
      await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: cap }, () => runWorker()));
}

async function gitClean() {
  const { code, out } = await run('git', ['status', '--porcelain'], { cwd: repoRoot });
  if (code !== 0) return false;
  return out.trim().length === 0;
}

async function writeFailureDoc({ slug, title, link, branch, testCmd, errTail, analysis, sourceExcerpt, sourceFetchError }) {
  const dir = join(repoRoot, 'doc', 'evolution', 'failure');
  await mkdir(dir, { recursive: true });
  const name = `${utcDateString(new Date())}-${slug}.md`;
  const p = join(dir, name);
  const excerptBlock =
    sourceFetchError && !sourceExcerpt
      ? `_抓取来源正文失败：${sourceFetchError}_\n`
      : sourceExcerpt
        ? `\`\`\`\n${sourceExcerpt.slice(0, 16000)}\n\`\`\`\n`
        : '_（无正文摘录）_\n';
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

## 来源正文摘录（抓取）
${excerptBlock}

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

async function writeSuccessDoc({ slug, title, link, branch, testCmd, outTail, merged, mergeCommit, sourceExcerpt, sourceFetchError }) {
  const dir = join(repoRoot, 'doc', 'evolution', 'success');
  await mkdir(dir, { recursive: true });
  const name = `${utcDateString(new Date())}-${slug}.md`;
  const p = join(dir, name);
  const excerptBlock =
    sourceFetchError && !sourceExcerpt
      ? `_抓取来源正文失败：${sourceFetchError}_\n`
      : sourceExcerpt
        ? `\`\`\`\n${sourceExcerpt.slice(0, 12000)}\n\`\`\`\n`
        : '_（无正文摘录）_\n';
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

## 来源正文摘录（抓取）
${excerptBlock}

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

async function writeRunDayLog(logLines) {
  if (truthy(process.env.EVOLUTION_NO_RUN_LOG)) return;
  const dir = join(repoRoot, 'doc', 'evolution', 'runs');
  await mkdir(dir, { recursive: true });
  const body = `# evolution-run-day 最近一次\n\n${logLines.join('\n')}\n\n（终端亦有相同时间戳行；设 \`EVOLUTION_NO_RUN_LOG=1\` 可禁用本文件）\n`;
  await writeFile(join(dir, 'latest-run-day.md'), body, 'utf8');
}

async function main() {
  const logLines = [];
  const trace = (msg) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    logLines.push(line);
    console.log(`evolution-run-day: ${line}`);
  };

  try {
    trace('启动');
    const inboxPath = pickInboxFile();
    if (!inboxPath) {
      trace('结束：无 inbox，请先执行 npm run evolution:learn');
      return;
    }

    const text = readFileSync(inboxPath, 'utf8');
    let items = parseInboxItems(text);
    const parsedTotal = items.length;
    const max = Math.max(0, Math.min(10, Number(process.env.EVOLUTION_MAX_ITEMS ?? 3) || 3));
    if (max === 0) {
      trace('结束：EVOLUTION_MAX_ITEMS=0，跳过');
      return;
    }
    items = items.slice(0, max);

    if (items.length === 0) {
      trace(`结束：inbox 中无 \`- [title](url)\` 行（已读 ${inboxPath}）`);
      return;
    }

    const allowDirty = truthy(process.env.EVOLUTION_ALLOW_DIRTY_WORKTREE);
    if (!allowDirty && !(await gitClean())) {
      trace('结束：工作区不干净（可设 EVOLUTION_ALLOW_DIRTY_WORKTREE=1）');
      console.error('evolution-run-day: git working tree is not clean (set EVOLUTION_ALLOW_DIRTY_WORKTREE=1 to override)');
      process.exitCode = 1;
      return;
    }

    const targetBranch = process.env.EVOLUTION_TARGET_BRANCH?.trim() || process.env.RAW_AGENT_SELF_HEAL_TARGET_BRANCH?.trim() || 'main';
    const autoMerge = truthy(process.env.EVOLUTION_AUTO_MERGE);
    const testCmd = process.env.EVOLUTION_TEST_CMD?.trim() || 'npm run test:unit';
    const skipCi = truthy(process.env.EVOLUTION_SKIP_NPM_CI);

    trace(`inbox: ${inboxPath}`);
    trace(`解析: inbox 内共 ${parsedTotal} 条链接，本跑取前 ${items.length} 条（EVOLUTION_MAX_ITEMS=${max}）`);
    trace(`策略: 目标分支=${targetBranch}, 测试=${testCmd}, npm ci=${skipCi ? '跳过' : '执行'}, 自动合并=${autoMerge ? '是' : '否'}`);
    trace(
      '说明：每条会先抓取来源 URL 的正文摘录（供对照）；验证阶段在本仓库独立 worktree 跑白名单测试，不克隆外链仓库。'
    );

    let conc = Math.min(3, Math.max(1, Number(process.env.EVOLUTION_CONCURRENCY ?? 3) || 3));
    if (autoMerge) {
      conc = 1;
      trace('EVOLUTION_AUTO_MERGE=1 → 并发强制为 1（避免合并主分支竞态）');
    } else {
      trace(`并发: ${conc}（EVOLUTION_CONCURRENCY，上限 3）`);
    }

    const today = utcDateString(new Date());
    const wtRoot = join(repoRoot, '.evolution-worktrees');
    await mkdir(wtRoot, { recursive: true });

    const runOne = async ({ title, link }, i) => {
      const slot = `${i + 1}/${items.length}`;
      const itemTrace = (msg) => trace(`[${slot}] ${msg}`);

      const slug = makeSlug(title, link);
      const branch = `exp/evolution-${today}-${slug}`;
      const wtPath = join(wtRoot, `${today}-${slug}`);

      itemTrace(`━━ 开始 ━━`);
      itemTrace(`标题: ${title}`);
      itemTrace(`链接: ${link}`);

      const tFetch = Date.now();
      const fetched = await fetchSourceExcerpt(link);
      if (fetched.ok && fetched.excerpt) {
        itemTrace(`来源正文已抓取 ${fetched.excerpt.length} 字（${Date.now() - tFetch}ms）`);
      } else {
        itemTrace(`来源正文抓取失败或为空: ${fetched.error || 'empty'}（${Date.now() - tFetch}ms）`);
      }
      const sourceExcerpt = fetched.excerpt || '';
      const sourceFetchError = fetched.ok ? '' : fetched.error || 'fetch failed';

      itemTrace(`slug=${slug} → 分支 ${branch}，worktree ${wtPath}`);

      const tPrep = Date.now();
      await removeWorktree(wtPath);
      await deleteBranch(branch);
      itemTrace(`清理旧 worktree/分支 (${Date.now() - tPrep}ms)`);

      const tWt = Date.now();
      const add = await run('git', ['worktree', 'add', '-b', branch, wtPath, targetBranch], { cwd: repoRoot });
      itemTrace(`git worktree add → exit=${add.code} (${Date.now() - tWt}ms)`);
      if (add.code !== 0) {
        itemTrace('结果: 失败（worktree）→ 已写 doc/evolution/failure/');
        await writeFailureDoc({
          slug,
          title,
          link,
          branch,
          testCmd,
          errTail: add.out + add.err,
          analysis: 'git worktree add 失败（可能分支已存在或路径占用）。',
          sourceExcerpt,
          sourceFetchError
        });
        return;
      }

      let testOut = '';
      let testErr = '';
      let testCode = 1;

      if (!skipCi) {
        const tCi = Date.now();
        const ci = await sh('npm ci', wtPath);
        testOut += ci.out + ci.err;
        itemTrace(`npm ci → exit=${ci.code} (${Date.now() - tCi}ms)`);
        if (ci.code !== 0) {
          itemTrace('结果: 失败（npm ci）→ 已写 doc/evolution/failure/');
          await removeWorktree(wtPath);
          await writeFailureDoc({
            slug,
            title,
            link,
            branch,
            testCmd: 'npm ci',
            errTail: testOut,
            analysis: 'npm ci 失败（依赖或网络）。可设置 EVOLUTION_SKIP_NPM_CI=1 跳过安装（需自行保证 worktree 可测）。',
            sourceExcerpt,
            sourceFetchError
          });
          await deleteBranch(branch);
          return;
        }
      } else {
        itemTrace('npm ci 已跳过（EVOLUTION_SKIP_NPM_CI）');
      }

      const tTest = Date.now();
      const runTest = await sh(testCmd, wtPath);
      testOut += runTest.out;
      testErr += runTest.err;
      testCode = runTest.code;
      itemTrace(`测试命令「${testCmd}」→ exit=${testCode} (${Date.now() - tTest}ms)`);
      if (testCode !== 0) {
        itemTrace(`测试失败摘录:\n${tailForLog(testErr || testOut)}`);
      }

      await removeWorktree(wtPath);
      itemTrace('worktree 已移除');

      if (testCode !== 0) {
        itemTrace('结果: 失败（测试非零）→ 已写 doc/evolution/failure/');
        await writeFailureDoc({
          slug,
          title,
          link,
          branch,
          testCmd,
          errTail: testErr || testOut,
          analysis:
            '测试命令非零退出（本仓库快照）。外链项目不会自动克隆；失败原因见上方测试摘录与 failure 文档中的完整输出。',
          sourceExcerpt,
          sourceFetchError
        });
        await deleteBranch(branch);
        return;
      }

      let merged = false;
      let mergeCommit = '';
      if (autoMerge) {
        const tMerge = Date.now();
        const co = await run('git', ['checkout', targetBranch], { cwd: repoRoot });
        itemTrace(`git checkout ${targetBranch} → exit=${co.code}`);
        if (co.code !== 0) {
          itemTrace('结果: 失败（无法检出主分支以合并）');
          await writeFailureDoc({
            slug,
            title,
            link,
            branch,
            testCmd: `git checkout ${targetBranch}`,
            errTail: co.out + co.err,
            analysis: `测试通过但无法检出 ${targetBranch} 以合并。`,
            sourceExcerpt,
            sourceFetchError
          });
          return;
        }
        const mg = await run('git', ['merge', '--no-ff', '-m', `evolution: merge ${branch}`, branch], { cwd: repoRoot });
        itemTrace(`git merge ${branch} → exit=${mg.code} (${Date.now() - tMerge}ms)`);
        if (mg.code !== 0) {
          await run('git', ['merge', '--abort'], { cwd: repoRoot }).catch(() => {});
          itemTrace('结果: 失败（合并冲突或失败）');
          await writeFailureDoc({
            slug,
            title,
            link,
            branch,
            testCmd: `git merge ${branch}`,
            errTail: mg.out + mg.err,
            analysis: '测试通过但合并到主分支冲突或失败；实验分支仍保留，请手动处理。',
            sourceExcerpt,
            sourceFetchError
          });
          return;
        }
        merged = true;
        const rev = await run('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
        mergeCommit = rev.out.trim().slice(0, 40);
        itemTrace(`已合并，merge commit: ${mergeCommit}`);
        await run('git', ['branch', '-d', branch], { cwd: repoRoot }).catch(() => {});
      } else {
        itemTrace(`未自动合并：分支 ${branch} 保留，可手动 git merge`);
        console.log(`evolution-run-day: branch ${branch} kept for manual merge`);
      }

      itemTrace('结果: 成功 → 已写 doc/evolution/success/');
      await writeSuccessDoc({
        slug,
        title,
        link,
        branch,
        testCmd,
        outTail: testOut,
        merged,
        mergeCommit,
        sourceExcerpt,
        sourceFetchError
      });
    };

    await runPool(items, conc, runOne);

    trace('全部条目处理完毕');
    trace('可读摘要 → doc/evolution/runs/latest-run-day.md');
  } finally {
    try {
      await writeRunDayLog(logLines);
    } catch (e) {
      console.error('evolution-run-day: 写入 latest-run-day.md 失败', e);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
