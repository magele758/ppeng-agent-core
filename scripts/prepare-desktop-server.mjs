#!/usr/bin/env node
/**
 * 装配桌面客户端所需的自包含服务端 bundle。
 *
 * 输出结构（apps/desktop/server-bundle/）：
 *   server-bundle/
 *     apps/daemon/dist/**          <- daemon 编译产物
 *     packages/<pkg>/dist/**       <- 各 workspace 包编译产物
 *     packages/<pkg>/package.json
 *     node_modules/**              <- 生产依赖（含 @ppeng/* 软链替换为实体）
 *
 * daemon 通过 node:sqlite（Node 22 内置）访问 SQLite，无需原生编译。
 * 第三方依赖（redis / pg / jsonrepair / aws-sdk / sharp 等）通过在 bundle
 * 内执行 `npm install --omit=dev` 安装为实体目录。
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const bundleDir = join(repoRoot, 'apps', 'desktop', 'server-bundle');

const WORKSPACE_PACKAGES = [
  'packages/core',
  'packages/capability-gateway',
  'packages/agent-sre',
  'packages/agent-stock'
];

function log(msg) {
  console.log(`[prepare-server] ${msg}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

// 1. 清理并创建 bundle 目录
log('清理旧 bundle...');
rmSync(bundleDir, { recursive: true, force: true });
mkdirSync(bundleDir, { recursive: true });

// 2. 复制 daemon 编译产物
const daemonDistSrc = join(repoRoot, 'apps', 'daemon', 'dist');
if (!existsSync(daemonDistSrc)) {
  console.error('❌ 找不到 apps/daemon/dist，请先运行 npm run build');
  process.exit(1);
}
log('复制 daemon dist...');
mkdirSync(join(bundleDir, 'apps', 'daemon'), { recursive: true });
cpSync(daemonDistSrc, join(bundleDir, 'apps', 'daemon', 'dist'), { recursive: true });
cpSync(
  join(repoRoot, 'apps', 'daemon', 'package.json'),
  join(bundleDir, 'apps', 'daemon', 'package.json')
);

// 3. 复制各 workspace 包的 dist + package.json
const bundleDeps = {};
// 先收集依赖信息；实体复制延后到 npm install 之后，避免被当成多余包清理
const copyLater = [];
for (const pkg of WORKSPACE_PACKAGES) {
  const src = join(repoRoot, pkg);
  const distSrc = join(src, 'dist');
  if (!existsSync(distSrc)) {
    console.error(`❌ 找不到 ${pkg}/dist，请先运行 npm run build`);
    process.exit(1);
  }
  const pkgJson = readJson(join(src, 'package.json'));
  copyLater.push({ name: pkgJson.name, distSrc, pkgJsonPath: join(src, 'package.json') });

  for (const [dep, ver] of Object.entries(pkgJson.dependencies ?? {})) {
    if (!dep.startsWith('@ppeng/')) bundleDeps[dep] = ver;
  }
  for (const [dep, ver] of Object.entries(pkgJson.optionalDependencies ?? {})) {
    if (!dep.startsWith('@ppeng/')) bundleDeps[dep] = ver;
  }
}

// 4. 合并 daemon 的第三方依赖
const daemonPkg = readJson(join(repoRoot, 'apps', 'daemon', 'package.json'));
for (const [dep, ver] of Object.entries(daemonPkg.dependencies ?? {})) {
  if (!dep.startsWith('@ppeng/')) bundleDeps[dep] = ver;
}

// 5. 写一个 bundle 顶层 package.json 用于安装第三方依赖
log('生成 bundle package.json...');
const bundlePkg = {
  name: 'ppeng-agent-desktop-server',
  version: '0.1.0',
  private: true,
  type: 'module',
  dependencies: bundleDeps
};
writeFileSync(
  join(bundleDir, 'package.json'),
  JSON.stringify(bundlePkg, null, 2)
);

// 6. 在 bundle 内安装生产依赖（实体目录，非软链）
log('安装生产依赖（npm install --omit=dev）...');
try {
  execSync('npm install --omit=dev --no-audit --no-fund --install-strategy=hoisted', {
    cwd: bundleDir,
    stdio: 'inherit'
  });
} catch (err) {
  console.error('❌ 依赖安装失败:', err.message);
  process.exit(1);
}

// 7. npm install 之后再复制 workspace 包（避免被 prune）
for (const { name, distSrc, pkgJsonPath } of copyLater) {
  const destPkgDir = join(bundleDir, 'node_modules', name);
  log(`复制 ${name}...`);
  mkdirSync(destPkgDir, { recursive: true });
  cpSync(distSrc, join(destPkgDir, 'dist'), { recursive: true });
  cpSync(pkgJsonPath, join(destPkgDir, 'package.json'));
}

log(`✅ 服务端 bundle 装配完成: ${bundleDir}`);
