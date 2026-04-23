/**
 * 构建 evolution 展示站并同步到本地 GitHub Pages 仓库；可选 commit + push。
 *
 * 环境变量：
 *   EVOLUTION_SHOWCASE_AUTO_DEPLOY=1  — run-day 自动路径下需开启；手动 CLI 可传 manual:true 跳过此项
 *   EVOLUTION_SHOWCASE_DEPLOY_DIR     — Pages 仓库根目录（须已 git clone 且含 .git）
 *   EVOLUTION_SHOWCASE_GIT_PUSH=1     — 复制后 git add/commit/push（需已配置 remote）
 *   EVOLUTION_SHOWCASE_PAGES_GIT_URL  — 可选，仅日志备忘（例如 https://github.com/magele758/magele758.github.io.git）
 */
import { cpSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, truthy } from './process.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dir, '..', '..');

/**
 * @param {{ trace?: (msg: string) => void; manual?: boolean }} [options]
 * - manual: true 时忽略 EVOLUTION_SHOWCASE_AUTO_DEPLOY（供 npm run evolution:showcase-deploy）
 * @returns {Promise<{ ok: boolean; skipped?: string }>}
 */
export async function deployShowcase(options = {}) {
  const trace = options.trace ?? (() => {});
  const manual = options.manual === true;

  if (!manual && !truthy(process.env.EVOLUTION_SHOWCASE_AUTO_DEPLOY)) {
    return { ok: true, skipped: 'auto_deploy_off' };
  }

  const deployDir = process.env.EVOLUTION_SHOWCASE_DEPLOY_DIR?.trim();
  if (!deployDir) {
    trace('展示站发布：未设置 EVOLUTION_SHOWCASE_DEPLOY_DIR，跳过');
    return { ok: false, skipped: 'no_deploy_dir' };
  }
  if (!existsSync(deployDir)) {
    trace(`展示站发布：目录不存在 ${deployDir}，跳过`);
    return { ok: false, skipped: 'bad_dir' };
  }
  if (!existsSync(join(deployDir, '.git'))) {
    trace(`展示站发布：${deployDir} 不是 git 仓库，跳过`);
    return { ok: false, skipped: 'not_git' };
  }

  const pagesOrigin = process.env.EVOLUTION_SHOWCASE_PAGES_GIT_URL?.trim();
  if (pagesOrigin) trace(`展示站发布：Pages 源仓库 ${pagesOrigin}`);

  trace('展示站发布：执行 build-evolution-showcase…');
  const build = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'build-evolution-showcase.mjs')], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env
  });
  if (build.status !== 0) {
    trace(`展示站发布：构建失败 exit=${build.status ?? build.signal}，跳过同步`);
    return { ok: false, skipped: 'build_failed' };
  }

  const distDir = join(repoRoot, 'evolution-showcase', 'dist');
  if (!existsSync(distDir)) {
    trace('展示站发布：evolution-showcase/dist 不存在，跳过');
    return { ok: false, skipped: 'no_dist' };
  }

  trace(`展示站发布：复制 dist → ${deployDir}`);
  for (const name of readdirSync(distDir)) {
    cpSync(join(distDir, name), join(deployDir, name), { recursive: true, force: true });
  }

  if (!truthy(process.env.EVOLUTION_SHOWCASE_GIT_PUSH)) {
    trace('展示站发布：已复制（未设 EVOLUTION_SHOWCASE_GIT_PUSH=1，不 git push）');
    return { ok: true };
  }

  let r = await run(deployDir, 'git', ['add', '-A']);
  if (r.code !== 0) {
    trace(`展示站发布：git add 失败 — ${(r.err || r.out).trim()}`);
    return { ok: false, skipped: 'git_add' };
  }

  r = await run(deployDir, 'git', ['diff', '--cached', '--quiet']);
  if (r.code === 0) {
    trace('展示站发布：Pages 仓库无变更，跳过 commit/push');
    return { ok: true };
  }

  const msg = `chore: sync evolution showcase ${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
  r = await run(deployDir, 'git', ['commit', '-m', msg]);
  if (r.code !== 0) {
    trace(`展示站发布：git commit 失败 — ${(r.err || r.out).trim()}`);
    return { ok: false, skipped: 'git_commit' };
  }

  r = await run(deployDir, 'git', ['push']);
  if (r.code !== 0) {
    trace(`展示站发布：git push 失败 — ${(r.err || r.out).trim()}`);
    return { ok: false, skipped: 'git_push' };
  }

  trace('展示站发布：已 push 到 GitHub Pages 仓库');
  return { ok: true };
}
